import type { ServerConfig, Logger } from '../shared/types.js';
import {
  createAppLogger,
  installConsoleBridge,
  installFatalHandlers,
} from '../shared/logging/index.js';
import type { CreatedLogger } from '../shared/logging/index.js';

let installed: CreatedLogger | undefined;

/**
 * Memoized CLI logger (`app:cli` transport). Creates the Pino file logger on
 * first use and installs the console bridge + fatal handlers exactly once per
 * process. Used by `app client ...` subcommands, which otherwise run with a
 * raw `console` and never touch the log files.
 */
export function ensureCliLogger(config: ServerConfig & { basePath?: string }): Logger {
  if (!installed) {
    installed = createAppLogger({
      name: 'app:cli',
      transport: 'cli',
      basePath: config.basePath,
      logging: config.logging,
      telemetry: config.telemetry,
    });
    installConsoleBridge(installed.logger);
    installFatalHandlers(installed.logger);
  }
  return installed.logger;
}

export async function closeCliLogger(): Promise<void> {
  const cur = installed;
  installed = undefined;
  if (cur) await cur.close().catch(() => {});
}
