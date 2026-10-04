import type { ServerConfig } from './shared/types.js';
import { bootstrap } from './bootstrap.js';
import { createApp } from './http/factory.js';
import { resolveListenHost } from './shared/host-policy.js';
import {
  createAppLogger,
  installConsoleBridge,
  installFatalHandlers,
} from './shared/logging/index.js';

export async function startServer(
  config: ServerConfig,
  opts: { basePath?: string } = {},
): Promise<void> {
  const created = createAppLogger({
    name: 'app:http',
    transport: 'http',
    basePath: opts.basePath,
    logging: config.logging,
    telemetry: config.telemetry,
  });
  const logger = created.logger;
  installConsoleBridge(logger);
  installFatalHandlers(logger);

  const ctx = await bootstrap(
    {
      dbPath: config.database.path,
      defaultClientSecretKey: config.auth.defaultClientSecretKey,
      shell: config.shell,
      mcp: config.mcp,
    },
    logger,
    { basePath: opts.basePath },
  );

  const app = createApp(ctx, { loggerInstance: created.pino });

  const defaultKeyActive = (config.auth.defaultClientSecretKey ?? '').trim() !== '';
  const listenPolicy = resolveListenHost(config.server.host, defaultKeyActive);
  if (listenPolicy.restricted) {
    logger.warn(
      {
        requestedHost: listenPolicy.requestedHost,
        listenHost: listenPolicy.host,
      },
      'Default Client Key is active: server restricted to local-only. Set auth.defaultClientSecretKey = "" in config.toml to allow network exposure.',
    );
  }

  await app.listen({ port: config.server.port, host: listenPolicy.host });
  app.log.info(`Server listening on ${listenPolicy.host}:${config.server.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down`);
    try {
      await app.close();
    } finally {
      await ctx.shutdown();
      await created.close().catch(() => {});
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
