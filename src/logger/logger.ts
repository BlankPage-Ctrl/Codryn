import winston from 'winston';
import path from 'path';
import fs from 'fs';
import type { TransformableInfo } from 'logform';
import { getLogLevel, isDev } from './logger.utils.js';
import { resolveConfigBasePath } from '../config/utils/path-resolver.js';

const MAX_SIZE = 256 * 1024; // 256 KB

function getStartupDir(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return path.join(resolveConfigBasePath(), 'logs', `folder_${ts}_logger`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getNextLogIndex(dir: string): number {
  if (!fs.existsSync(path.join(dir, 'log.txt'))) {
    return 0;
  }
  let idx = 1;
  while (fs.existsSync(path.join(dir, `log_${idx}.txt`))) {
    idx++;
  }
  return idx;
}

class StartupDirectoryTransport extends winston.transports.File {
  constructor(options: { dir: string; maxSize?: number; format?: winston.Logform.Format }) {
    ensureDir(options.dir);

    const idx = getNextLogIndex(options.dir);
    const filename = idx === 0 ? 'log.txt' : `log_${idx}.txt`;

    super({
      filename: path.join(options.dir, filename),
      maxsize: options.maxSize ?? MAX_SIZE,
      tailable: true,
      format: options.format,
    });
  }
}

function createBaseFormat(): winston.Logform.Format {
  return winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }));
}

function createFileFormat(): winston.Logform.Format {
  return winston.format.combine(
    createBaseFormat(),
    winston.format.printf((info: TransformableInfo) => {
      const ts = (info.timestamp as string) ?? '';
      const lvl = info.level ?? '';
      const log = (info.logger as string) ?? '';
      const msg = (info.message as string) ?? '';

      const parts = [`${ts} [${lvl.toUpperCase()}] [${log}] ${msg}`];

      const stack = info.stack;
      if (typeof stack === 'string' && stack.length > 0) {
        parts.push(`\n${stack}`);
      }

      const meta: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(info)) {
        if (
          key !== 'timestamp' &&
          key !== 'level' &&
          key !== 'message' &&
          key !== 'logger' &&
          key !== 'stack'
        ) {
          meta[key] = value;
        }
      }
      if (Object.keys(meta).length > 0) {
        parts.push(JSON.stringify(meta, null, 2));
      }

      return parts.join(' ');
    }),
  );
}

function createDevFormat(): winston.Logform.Format {
  return winston.format.combine(
    createBaseFormat(),
    winston.format.colorize(),
    winston.format.printf((info: TransformableInfo) => {
      const ts = (info.timestamp as string) ?? '';
      const lvl = info.level ?? '';
      const log = (info.logger as string) ?? '';
      const msg = (info.message as string) ?? '';

      const parts = [`${ts} ${lvl} [${log}] ${msg}`];

      const stack = info.stack;
      if (typeof stack === 'string' && stack.length > 0) {
        parts.push(`\n${stack}`);
      }

      const meta: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(info)) {
        if (
          key !== 'timestamp' &&
          key !== 'level' &&
          key !== 'message' &&
          key !== 'logger' &&
          key !== 'stack'
        ) {
          meta[key] = value;
        }
      }
      if (Object.keys(meta).length > 0) {
        parts.push(JSON.stringify(meta, null, 2));
      }

      return parts.join(' ');
    }),
  );
}

export class Logger {
  private winston: winston.Logger;
  readonly name: string;

  constructor(name: string, options?: { level?: string }) {
    this.name = name;
    const level = options?.level ?? getLogLevel();
    const dev = isDev();

    const transports: winston.transport[] = [
      new StartupDirectoryTransport({
        dir: getStartupDir(),
        format: createFileFormat(),
      }),
    ];

    if (dev) {
      transports.push(
        new winston.transports.Console({
          format: createDevFormat(),
        }),
      );
    }

    this.winston = winston.createLogger({
      level,
      defaultMeta: { logger: name },
      transports,
    });
  }

  child(meta: Record<string, unknown>): Logger {
    const childLogger = new Logger(this.name);

    (childLogger as Logger).winston = this.winston.child(meta) as winston.Logger;
    return childLogger;
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.winston.error(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.winston.warn(message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.winston.info(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.winston.debug(message, meta);
  }

  verbose(message: string, meta?: Record<string, unknown>): void {
    this.winston.verbose(message, meta);
  }

  silly(message: string, meta?: Record<string, unknown>): void {
    this.winston.silly(message, meta);
  }
}
