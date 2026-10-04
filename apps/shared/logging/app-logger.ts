import { Writable } from 'node:stream';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import type { Logger as PinoInstance } from 'pino';
import { isDevMode } from '../../../src/config/utils/path-resolver.js';
import { DEFAULT_MAX_FILES, DEFAULT_MAX_SIZE_MB, resolveLogPaths } from './paths.js';
import { isMarkedSensitive, redact } from './sensitive.js';
import { normalizeArgs } from './serialize-error.js';
import { NoopTelemetry } from './telemetry.js';
import type { TelemetryEvent, TelemetrySink } from './telemetry.js';
import type { AppLoggerOptions, TransportKind } from './types.js';
import type { Logger as AppLogger } from '../types.js';

export interface CreatedLogger {
  logger: AppLogger & {
    child(bindings: Record<string, unknown>): AppLogger;
    close(): Promise<void>;
    flush(): Promise<void>;
  };
  pino: PinoInstance;
  dir: string;
  jsonlPath: string;
  humanPath: string;
  close(): Promise<void>;
  flush(): Promise<void>;
}

/** Size-based rotating file writer: app.log, app.log.1 ... app.log.N (same for jsonl). */
class RotatingFile {
  private stream: WriteStream | undefined;
  private size = 0;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {
    mkdirSync(join(filePath, '..'), { recursive: true });
    try {
      this.size = existsSync(filePath) ? statSync(filePath).size : 0;
    } catch {
      this.size = 0;
    }
    this.stream = createWriteStream(filePath, { flags: 'a' });
    this.stream.on('error', () => {
      // Logging must never crash the app; errors are swallowed here and
      // surfaced once via stderr by the fanout writer.
    });
  }

  write(data: string): void {
    const len = Buffer.byteLength(data);
    if (this.size + len > this.maxBytes) {
      this.rotate();
    }
    try {
      this.stream?.write(data);
      this.size += len;
    } catch {
      // ignore - logger is best-effort
    }
  }

  private rotate(): void {
    try {
      this.stream?.end();
    } catch {
      // ignore
    }
    try {
      rmSync(`${this.filePath}.${this.maxFiles}`, { force: true });
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const from = `${this.filePath}.${i}`;
        const to = `${this.filePath}.${i + 1}`;
        if (existsSync(from)) renameSync(from, to);
      }
      if (existsSync(this.filePath)) renameSync(this.filePath, `${this.filePath}.1`);
    } catch {
      // ignore rotation failures - continue writing to current file
    }
    this.size = 0;
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.stream) return resolve();
      this.stream.end(() => resolve());
      setTimeout(resolve, 1000).unref?.();
    });
  }
}

const NUM_LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

function levelName(level: unknown): string {
  if (typeof level === 'number') return NUM_LEVELS[level] ?? String(level);
  return String(level ?? 'info').toUpperCase();
}

function formatHuman(record: Record<string, unknown>): string {
  const ts =
    typeof record['time'] === 'number'
      ? new Date(record['time'] as number).toISOString()
      : ((record['ts'] as string) ?? new Date().toISOString());
  const level = levelName(record['level']);
  const name = String(record['logger'] ?? record['name'] ?? 'app');
  const msg = String(record['msg'] ?? '');
  const pid = record['pid'] !== undefined ? ` pid=${String(record['pid'])}` : '';
  const skip = new Set([
    'time',
    'ts',
    'level',
    'logger',
    'name',
    'msg',
    'pid',
    'hostname',
    'transport',
  ]);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!skip.has(k)) rest[k] = v;
  }
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${ts} [${level}] [${name}]${pid} ${msg}${extra}\n`;
}

const PINO_LEVELS: Record<string, string> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

function resolveLevel(explicit?: string): string {
  const raw = (process.env.LOG_LEVEL ?? explicit ?? '').trim().toLowerCase();
  if (raw !== '' && PINO_LEVELS[raw] !== undefined) return raw;
  return isDevMode() ? 'debug' : 'info';
}

interface FanoutDeps {
  jsonl: RotatingFile;
  human: RotatingFile;
  telemetry: TelemetrySink;
  transport: TransportKind;
  appName: string;
  consoleEnabled: boolean;
  stderr: NodeJS.WriteStream;
}

/** Receives pino JSON lines, fans out to jsonl + human + stderr + telemetry gate. */
class FanoutStream extends Writable {
  private warned = false;
  constructor(private readonly deps: FanoutDeps) {
    super({ objectMode: false });
  }

  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    try {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        this.handleLine(line);
      }
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  private handleLine(line: string): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Unparseable - still persist raw for forensics.
      this.deps.jsonl.write(`${line}\n`);
      this.deps.human.write(`${line}\n`);
      return;
    }

    const sensitive = isMarkedSensitive(record);
    const { value: redactedFields, redactedKeys } = redact(record);
    const safe = redactedFields as Record<string, unknown>;
    if (redactedKeys.length > 0) {
      safe['redactedKeys'] = redactedKeys;
    }

    // Local files always get the REDACTED version (never raw secrets on disk either).
    this.deps.jsonl.write(`${JSON.stringify(safe)}\n`);
    this.deps.human.write(formatHuman(safe));

    if (this.deps.consoleEnabled) {
      try {
        this.deps.stderr.write(formatHuman(safe));
      } catch {
        if (!this.warned) {
          this.warned = true;
        }
      }
    }

    // Telemetry gate: sensitive records are DROPPED, never sent.
    if (sensitive) return;
    const event: TelemetryEvent = {
      ts: new Date(
        typeof safe['time'] === 'number' ? (safe['time'] as number) : Date.now(),
      ).toISOString(),
      level:
        typeof safe['level'] === 'number'
          ? (pino.levels.labels[safe['level'] as number] ?? 'info')
          : String(safe['level'] ?? 'info'),
      logger: String(safe['logger'] ?? this.deps.appName),
      msg: String(safe['msg'] ?? ''),
      fields: safe,
      redactedKeys,
      transport: this.deps.transport,
      pid: typeof safe['pid'] === 'number' ? (safe['pid'] as number) : process.pid,
    };
    try {
      this.deps.telemetry.emit(event);
    } catch {
      // telemetry must never break logging
    }
  }
}

export function createAppLogger(options: AppLoggerOptions = {}): CreatedLogger {
  const transport: TransportKind = options.transport ?? 'http';
  const appName = options.name ?? `app:${transport}`;
  const maxBytes = Math.max(1, options.logging?.maxSizeMb ?? DEFAULT_MAX_SIZE_MB) * 1024 * 1024;
  const maxFiles = Math.max(1, options.logging?.maxFiles ?? DEFAULT_MAX_FILES);
  const level = resolveLevel(options.logging?.level);

  const {
    dir,
    jsonl: jsonlPath,
    human: humanPath,
  } = (() => {
    const explicit = options.logging?.dir?.trim() ?? '';
    if (explicit !== '') {
      return {
        dir: explicit,
        jsonl: join(explicit, 'app.jsonl'),
        human: join(explicit, 'app.log'),
      };
    }
    return resolveLogPaths(options.basePath);
  })();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // fall through - RotatingFile swallows write errors; stderr still works
  }

  const jsonl = new RotatingFile(jsonlPath, maxBytes, maxFiles);
  const human = new RotatingFile(humanPath, maxBytes, maxFiles);

  // Telemetry is opt-in only. Default is Noop (local-only, desktop policy).
  // Callers must explicitly pass `telemetrySink`; HttpTelemetrySink is never
  // constructed here and no entrypoint passes a sink.
  const telemetry: TelemetrySink = options.telemetrySink ?? new NoopTelemetry();

  const consoleEnabled = options.logging?.consoleEnabled ?? isDevMode();
  const fanout = new FanoutStream({
    jsonl,
    human,
    telemetry,
    transport,
    appName,
    consoleEnabled,
    stderr: process.stderr,
  });

  const instance = pino({ level, base: { pid: process.pid, transport, logger: appName } }, fanout);

  const wrap = (
    inst: PinoInstance,
  ): AppLogger & {
    child(b: Record<string, unknown>): AppLogger;
    close(): Promise<void>;
    flush(): Promise<void>;
  } => {
    const call = (pinoLevel: 'info' | 'error' | 'warn' | 'debug', obj: unknown, msg?: string) => {
      const { fields, msg: text } = normalizeArgs(obj, msg);
      (inst[pinoLevel] as (f: Record<string, unknown>, m?: string) => void)(
        fields,
        text === '' ? undefined : text,
      );
    };
    return {
      info: (obj, msg) => call('info', obj, msg),
      error: (obj, msg) => call('error', obj, msg),
      warn: (obj, msg) => call('warn', obj, msg),
      debug: (obj, msg) => call('debug', obj, msg),
      child: (bindings: Record<string, unknown>) => wrap(inst.child(bindings)),
      close: () => closeAll(),
      flush: () => flushAll(),
    };
  };

  let closed = false;
  const flushAll = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      try {
        instance.flush(() => resolve());
        setTimeout(resolve, 1000).unref?.();
      } catch {
        resolve();
      }
    });
    try {
      await telemetry.flush();
    } catch {
      // ignore
    }
  };

  const closeAll = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await flushAll().catch(() => {});
    await Promise.all([jsonl.close(), human.close()]).catch(() => {});
    await telemetry.close().catch(() => {});
  };

  const logger = wrap(instance);
  logger.info(
    {
      logDir: dir,
      jsonl: jsonlPath,
      human: humanPath,
      level,
      transport,
      telemetry: 'noop (local-only)',
    },
    'logger initialized',
  );

  return { logger, pino: instance, dir, jsonlPath, humanPath, close: closeAll, flush: flushAll };
}
