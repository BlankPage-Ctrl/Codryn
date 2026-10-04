import 'dotenv/config';
import { Command } from 'commander';
import { ConfigService, t, resolveDatabasePath } from '../../src/config/index.js';
import { startServer } from '../server.js';
import { startStdio } from '../stdio/index.js';
import { registerCommands } from './commands/index.js';
import { closeCliLogger } from './logging.js';
import { getVersion } from '../shared/version.js';
import type { ServerConfig } from '../shared/types.js';

const configShape = {
  server: {
    port: t.number().default(3000),
    host: t.string().default('127.0.0.1'),
  },
  database: {
    path: t.string().default('data.db'),
  },
  auth: {
    defaultClientSecretKey: t.string().default('default-01KY288BNYMXFXEK5GF3N82MT8'),
  },
  shell: {
    enabled: t.boolean().default(true),
    shell: t.string().default('bash'),
    defaultTimeoutMs: t.number().default(30_000),
    maxOutputChars: t.number().default(25_000),
    defaultMode: t.enum(['allow', 'ask', 'deny']).default('ask'),
    hardDeny: t.array(t.string()).default([]),
    approvalEnabled: t.boolean().default(true),
    approvalTtlMs: t.number().default(5 * 60_000),
  },
  mcp: {
    enabled: t.boolean().default(true),
    toolsEnabled: t.boolean().default(true),
    resourcesEnabled: t.boolean().default(false),
    promptsEnabled: t.boolean().default(false),
    elicitationEnabled: t.boolean().default(false),
    defaultTimeoutMs: t.number().default(60_000),
    maxServers: t.number().default(8),
    maxToolsPerServer: t.number().default(32),
  },
  logging: {
    level: t.string().default(''),
    maxSizeMb: t.number().default(10),
    maxFiles: t.number().default(14),
    consoleEnabled: t.boolean().default(true),
  },
  telemetry: {
    // NOT WIRED. Stub provided in apps/shared/logging/telemetry.ts.
    enabled: t.boolean().default(false),
    endpoint: t.string().default(''),
  },
};

function collectCliArgs(opts: Record<string, unknown>): Record<string, unknown> {
  const serverArgs: Record<string, unknown> = {};
  const map: Record<string, string> = {
    host: 'server.host',
    port: 'server.port',
    auth: 'auth.defaultClientSecretKey',
    logLevel: 'logging.level',
  };

  for (const [flag, path] of Object.entries(map)) {
    if (opts[flag] !== undefined) {
      const keys = path.split('.');
      let target = serverArgs;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {};
        target = target[keys[i]] as Record<string, unknown>;
      }
      target[keys[keys.length - 1]] = opts[flag];
    }
  }

  return serverArgs;
}

function resolveConfig(opts: Record<string, unknown>): ServerConfig {
  const cliArgs = collectCliArgs(opts);
  const dataDir =
    typeof opts.dataDir === 'string' && opts.dataDir.trim() !== '' ? opts.dataDir : undefined;
  const service = new ConfigService(configShape, dataDir)
    .fromFile(opts.config as string | undefined)
    .override(cliArgs);
  const config = service.build() as ServerConfig;
  config.database.path = resolveDatabasePath(config.database.path, service.basePath);
  (config as ServerConfig & { basePath: string }).basePath = service.basePath;
  return config;
}

export function runCli(): void {
  const program = new Command();

  program
    .name('codryn')
    .description('Codryn backend (Fastify + SQLite + Drizzle).')
    .version(getVersion());

  program.option('--config <path>', 'Path to config TOML file');
  program.option(
    '--data-dir <dir>',
    'Base data dir (default: cwd in dev, ~/.codryn/backend in production)',
  );
  program.option('--host <host>', 'Server host');
  program.option('--port <port>', 'Server port', (val) => Number(val));
  program.option('--log-level <level>', 'Log level (trace|debug|info|warn|error)');

  registerCommands(program, {
    resolveConfig: (opts) => resolveConfig(opts),
  });

  // Flush the CLI file logger after any subcommand (e.g. `app client ...`).
  // The default http/stdio action path manages its own logger instead.
  program.hook('postAction', async () => {
    await closeCliLogger();
  });

  program.action(async (opts) => {
    const config = resolveConfig(opts);
    const basePath = (config as ServerConfig & { basePath?: string }).basePath;
    const transport = process.env.TRANSPORT === 'stdio' ? 'stdio' : 'http';

    if (transport === 'stdio') {
      await startStdio(config, { basePath });
      return;
    }
    await startServer(config, { basePath });
  });

  program.parse();
}
