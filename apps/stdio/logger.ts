import type { Logger } from '../shared/types.js';

function format(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * @deprecated No longer used by any entrypoint (`startStdio` uses
 * `createAppLogger({ transport: 'stdio' })` from `../shared/logging`, which
 * writes to `app.jsonl`/`app.log` plus stderr). Kept only for backward
 * compatibility: stderr-only, no file output, no redaction, no telemetry
 * gate. Do not use in new code.
 */
export function createStdioLogger(): Logger {
  const write = (level: 'info' | 'warn' | 'error' | 'debug', obj: unknown, msg?: string) => {
    const line = msg !== undefined ? `${msg} ${format(obj)}` : format(obj);
    process.stderr.write(`[${level}] ${line}\n`);
  };

  return {
    info: (obj, msg) => write('info', obj, msg),
    warn: (obj, msg) => write('warn', obj, msg),
    error: (obj, msg) => write('error', obj, msg),
    debug: (obj, msg) => write('debug', obj, msg),
  };
}
