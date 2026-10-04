import type { Logger } from '../types.js';
import { toLoggableError } from './serialize-error.js';

const INSTALLED = Symbol.for('app.logger.fatalInstalled');

/**
 * Persist uncaughtException / unhandledRejection / warnings with full
 * fidelity (stack + cause chain + proc context) before exiting.
 * Idempotent - safe to call from both http and stdio entrypoints.
 */
export function installFatalHandlers(logger: Logger): () => void {
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[INSTALLED] === true) return () => {};

  const onUncaught = (err: unknown) => {
    try {
      logger.error({ err: toLoggableError(err) }, 'uncaughtException');
    } catch {
      // last resort
      process.stderr.write(`[fatal] uncaughtException: ${(err as Error)?.stack ?? String(err)}\n`);
    }
    // Flush best-effort, then exit non-zero. setTimeout unref'd so a hung
    // stream cannot keep a crashed process alive.
    setTimeout(() => process.exit(1), 500).unref?.();
  };

  const onUnhandled = (reason: unknown) => {
    try {
      logger.error({ err: toLoggableError(reason) }, 'unhandledRejection');
    } catch {
      process.stderr.write(`[fatal] unhandledRejection: ${String(reason)}\n`);
    }
  };

  const onWarning = (warning: Error) => {
    try {
      logger.warn({ err: toLoggableError(warning) }, 'process warning');
    } catch {
      // ignore
    }
  };

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  process.on('warning', onWarning);
  g[INSTALLED] = true;

  return () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
    process.off('warning', onWarning);
    g[INSTALLED] = false;
  };
}
