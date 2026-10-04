import type { Logger } from '../types.js';
import { normalizeArgs, toLoggableError } from './serialize-error.js';

/**
 * Mirror every console.* call into the app logger (file + telemetry gate).
 * Output still goes to the ORIGINAL stderr - never stdout - so the stdio
 * JSON-RPC channel on stdout stays clean.
 */
export function installConsoleBridge(logger: Logger): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const stdioSafe = process.env.TRANSPORT === 'stdio';

  const forward = (level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]) => {
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : tryStringify(a))).join(' ');
      const errs = args.filter((a) => a instanceof Error);
      if (errs.length > 0) {
        logger[level]({ args: text, err: toLoggableError(errs[0]) }, 'console');
      } else {
        const { fields } = normalizeArgs(args.length === 1 ? args[0] : { args: text });
        logger[level](
          fields,
          args.length === 1 && typeof args[0] === 'string' ? undefined : text || 'console',
        );
      }
    } catch {
      // never break the app because logging failed
    }
  };

  console.log = (...args: unknown[]) => {
    forward('info', args);
    // In stdio mode stdout is the JSON-RPC channel - never let console.*
    // passthrough pollute it; redirect to stderr instead.
    if (stdioSafe) original.info(...(args as []));
    else original.log(...(args as []));
  };
  console.info = (...args: unknown[]) => {
    forward('info', args);
    // console.info already goes to stdout in Node - reroute under stdio.
    if (stdioSafe)
      process.stderr.write(
        `${args.map((a) => (typeof a === 'string' ? a : tryStringify(a))).join(' ')}\n`,
      );
    else original.info(...(args as []));
  };
  console.warn = (...args: unknown[]) => {
    forward('warn', args);
    original.warn(...(args as []));
  };
  console.error = (...args: unknown[]) => {
    forward('error', args);
    original.error(...(args as []));
  };
  console.debug = (...args: unknown[]) => {
    forward('debug', args);
    original.debug(...(args as []));
  };

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  };
}

function tryStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
