import type { Command } from 'commander';
import { startServer } from '../../server.js';
import { startStdio } from '../../stdio/index.js';
import type { CommandDeps } from './index.js';
import type { ServerConfig } from '../../shared/types.js';

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('--config <path>', 'Path to config TOML file')
    .option(
      '--data-dir <dir>',
      'Base data dir (default: cwd in dev, ~/.codryn/backend in production)',
    )
    .option('--host <host>', 'Server host')
    .option('--port <port>', 'Server port', (val) => Number(val))
    .option('--log-level <level>', 'Log level (trace|debug|info|warn|error)');
}

function mergedOpts(parent: Command, serve: Command, sub?: Command): Record<string, unknown> {
  return {
    ...parent.opts(),
    ...serve.opts(),
    ...(sub ? sub.opts() : {}),
  };
}

function basePathOf(config: ServerConfig): { basePath?: string } {
  const basePath = (config as ServerConfig & { basePath?: string }).basePath;
  return basePath ? { basePath } : {};
}

async function runStdio(
  deps: CommandDeps,
  parent: Command,
  serve: Command,
  sub: Command,
): Promise<void> {
  const config = deps.resolveConfig(mergedOpts(parent, serve, sub));
  await startStdio(config, basePathOf(config));
}

async function runHttp(
  deps: CommandDeps,
  parent: Command,
  serve: Command,
  sub?: Command,
): Promise<void> {
  const config = deps.resolveConfig(mergedOpts(parent, serve, sub));
  await startServer(config, basePathOf(config));
}

export function registerServeCommands(parent: Command, deps: CommandDeps): void {
  const serve = parent.command('serve').description('Start the backend server');

  addSharedOptions(serve);

  // Bare `codryn serve` keeps the historical default: http unless
  // TRANSPORT=stdio (same rule as the root default action).
  serve.action(async () => {
    if (process.env.TRANSPORT === 'stdio') {
      const config = deps.resolveConfig(mergedOpts(parent, serve));
      await startStdio(config, basePathOf(config));
      return;
    }
    await runHttp(deps, parent, serve);
  });

  const stdio = serve
    .command('stdio')
    .description('Start over STDIO (JSON-RPC over NDJSON, for desktop/embedded use)');
  addSharedOptions(stdio);
  stdio.action(async () => {
    await runStdio(deps, parent, serve, stdio);
  });

  const http = serve.command('http').description('Start the HTTP server (Fastify)');
  addSharedOptions(http);
  http.action(async () => {
    await runHttp(deps, parent, serve, http);
  });
}
