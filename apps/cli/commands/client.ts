import type { Command } from 'commander';
import { bootstrap } from '../../bootstrap.js';
import type { Container } from '../../bootstrap.js';
import {
  createClient,
  listClients,
  rotateClientSecret,
  deleteClient,
} from '../../actions/index.js';
import type { Logger } from '../../shared/types.js';
import { ensureCliLogger } from '../logging.js';
import type { CommandDeps } from './index.js';

/**
 * Data output - written DIRECTLY to stdout, bypassing the console bridge on
 * purpose. `create`/`rotate` responses carry a plain `secretKey` that must
 * never land in the log files (stringified secrets defeat key-based
 * redaction). Use `ctx.logger` for audit lines, never `print()`, for secrets.
 */
function writeData(data: unknown, desc: string): void {
  process.stdout.write(`${JSON.stringify({ desc, data }, null, 2)}\n`);
}

async function loadContainer(
  deps: CommandDeps,
  program: Command,
): Promise<{ ctx: Container; logger: Logger }> {
  const config = deps.resolveConfig(program.opts());
  const logger = ensureCliLogger(config);
  const ctx = await bootstrap(
    {
      dbPath: config.database.path,
      defaultClientSecretKey: config.auth.defaultClientSecretKey,
    },
    logger,
    { basePath: (config as typeof config & { basePath?: string }).basePath },
  );
  return { ctx, logger };
}

export function registerClientCommands(parent: Command, deps: CommandDeps): void {
  const cmd = parent.command('client').description('Manage API clients');

  cmd
    .command('create')
    .description('Create a new client')
    .requiredOption('--name <name>', 'Client name')
    .option('--description <desc>', 'Client description')
    .action(async (opts) => {
      const { ctx, logger } = await loadContainer(deps, parent);
      const client = await createClient(ctx, {
        name: opts.name,
        description: opts.description,
      });

      writeData(
        {
          clientId: client.clientId,
          secretKey: client.secretKey,
          name: client.name,
        },
        'Save these credentials! SecretKey will NOT be shown again.',
      );
      logger.info(
        { sensitive: true, clientId: client.clientId, action: 'client.create' },
        'client credential issued (secretKey shown on stdout only)',
      );
    });

  cmd
    .command('list')
    .description('List all clients')
    .action(async () => {
      const { ctx } = await loadContainer(deps, parent);
      const clients = await listClients(ctx);
      const safe = clients.map((c) => ({
        id: c.id,
        clientId: c.clientId,
        name: c.name,
        isActive: c.isActive,
        createdAt: c.createdAt,
        description: c.description,
      }));

      writeData(safe, 'Registered clients (secretKey hidden for security)');
    });

  cmd
    .command('rotate')
    .description('Rotate client secret key')
    .argument('<id>', 'Client ID')
    .action(async (id: string) => {
      const { ctx, logger } = await loadContainer(deps, parent);
      const client = await rotateClientSecret(ctx, { id });

      writeData(
        {
          clientId: client.clientId,
          secretKey: client.secretKey,
          name: client.name,
        },
        'SecretKey rotated! Copy the new key now.',
      );
      logger.info(
        { sensitive: true, clientId: client.clientId, action: 'client.rotate' },
        'client secret rotated (new key shown on stdout only)',
      );
    });

  cmd
    .command('delete')
    .description('Delete a client')
    .argument('<id>', 'Client ID')
    .action(async (id: string) => {
      const { ctx, logger } = await loadContainer(deps, parent);
      const client = await deleteClient(ctx, { id });

      writeData({ clientId: client.clientId }, 'Client deleted successfully.');
      logger.info(
        { sensitive: true, clientId: client.clientId, action: 'client.delete' },
        'client deleted',
      );
    });
}
