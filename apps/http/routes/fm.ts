import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { listFiles, getStat, readFile, searchFiles, watchFile } from '../../actions/index.js';
import {
  validateWorkspaceId,
  validateListDirQuery,
  validateGetStatQuery,
  validateReadFileQuery,
  validateSearchFilesQuery,
} from '../../validators/fm.js';

export function registerFmRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:workspaceId/files', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const { path } = validateListDirQuery(req.query);
    return listFiles(ctx, { workspaceId, path: path ?? '' });
  });

  app.get('/workspaces/:workspaceId/files/stat', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const { path } = validateGetStatQuery(req.query);
    return getStat(ctx, { workspaceId, path: path ?? '' });
  });

  app.get('/workspaces/:workspaceId/files/read', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const { path, maxBytes } = validateReadFileQuery(req.query);
    return readFile(ctx, {
      workspaceId,
      path: path ?? '',
      options: maxBytes !== undefined ? { maxBytes } : undefined,
    });
  });

  app.get('/workspaces/:workspaceId/files/search', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const { path, query, maxResults, maxDepth } = validateSearchFilesQuery(req.query);
    return searchFiles(ctx, {
      workspaceId,
      path: path ?? '',
      query,
      options: { maxResults, maxDepth },
    });
  });

  app.get('/workspaces/:workspaceId/files/events', async (req, reply) => {
    const { workspaceId } = validateWorkspaceId(req.params);

    const { service, stream } = await watchFile(ctx, { workspaceId });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      void service.stop().catch((err) => app.log.error({ err }, 'watcher stop error'));
      stream.destroy();
    };

    stream.on('error', (err) => {
      app.log.error({ err }, 'sse stream error');
      stop();
    });

    // reply.raw 'close' fires on both graceful completion and client
    // disconnect, so the watcher is always torn down exactly once.
    reply.raw.on('close', stop);

    stream.pipe(reply.raw);
  });
}
