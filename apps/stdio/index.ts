import { createInterface } from 'node:readline';
import { bootstrap } from '../bootstrap.js';
import type { ServerConfig } from '../shared/types.js';
import { dispatch } from './dispatch.js';
import {
  createAppLogger,
  installConsoleBridge,
  installFatalHandlers,
} from '../shared/logging/index.js';
import {
  encodeLine,
  errorResponse,
  parseRequestLine,
  RpcErrorCode,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from './protocol.js';
import { StreamRegistry } from './streams.js';

export async function startStdio(
  config: ServerConfig,
  opts: { basePath?: string } = {},
): Promise<void> {
  const created = createAppLogger({
    name: 'app:stdio',
    transport: 'stdio',
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

  const abort = new AbortController();
  const streams = new StreamRegistry();
  const out = (msg: JsonRpcResponse | JsonRpcNotification) => {
    process.stdout.write(encodeLine(msg));
  };

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req;
    try {
      req = parseRequestLine(trimmed);
    } catch (err) {
      out(errorResponse(null, RpcErrorCode.PARSE_ERROR, (err as Error).message));
      return;
    }

    void dispatch({ ctx, logger, out, signal: abort.signal, streams }, req);
  });

  rl.on('close', () => {
    abort.abort();
    streams.abortAll();
    void created.close().finally(() => process.exit(0));
  });

  logger.info('stdio transport ready (JSON-RPC over NDJSON)');
}
