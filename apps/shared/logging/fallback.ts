import type { Logger } from '../types.js';

/**
 * Fail-loud fallback for code paths that forgot to inject a logger.
 * Writes once to stderr (never stdout - stdio protocol safety) so a missing
 * logger is visible instead of silently using raw `console`. Silent under
 * `NODE_ENV=test` to keep test output clean.
 */
export function fallbackLogger(scope: string): Logger {
  let warned = false;
  const warnOnce = () => {
    if (warned || process.env.NODE_ENV === 'test') return;
    warned = true;
    process.stderr.write(
      `[logging] WARNING: no logger injected for '${scope}', using console fallback\n`,
    );
  };
  return {
    info: (obj, msg) => {
      warnOnce();
      (console.info as (...a: unknown[]) => void)(obj, msg);
    },
    error: (obj, msg) => {
      warnOnce();
      (console.error as (...a: unknown[]) => void)(obj, msg);
    },
    warn: (obj, msg) => {
      warnOnce();
      (console.warn as (...a: unknown[]) => void)(obj, msg);
    },
    debug: (obj, msg) => {
      warnOnce();
      (console.debug as (...a: unknown[]) => void)(obj, msg);
    },
  };
}
