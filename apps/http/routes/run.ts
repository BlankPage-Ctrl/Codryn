import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  startMessageRun,
  watchMessageRun,
  getMessageRun,
  listMessageRuns,
  cancelMessageRun,
} from '../../actions/index.js';
import { validateSendMessage } from '../../validators/message.js';
import {
  validateRunParams,
  validateRunIdParams,
  validateWatchRunQuery,
} from '../../validators/run.js';

export function registerRunRoutes(app: FastifyInstance, ctx: Container) {
  app.post('/workspaces/:workspaceId/chats/:chatId/runs', async (req, reply) => {
    const { workspaceId, chatId } = validateRunParams(req.params);
    const input = validateSendMessage(req.body);
    const { run, assistantMessageId } = await startMessageRun(ctx, {
      workspaceId,
      chatId,
      message: input.message,
    });
    reply.code(202);
    return { runId: run.runId, assistantMessageId, status: run.status };
  });

  app.get('/workspaces/:workspaceId/chats/:chatId/runs', async (req) => {
    const { workspaceId, chatId } = validateRunParams(req.params);
    return listMessageRuns(ctx, { workspaceId, chatId });
  });

  app.get('/workspaces/:workspaceId/chats/:chatId/runs/:runId', async (req) => {
    const { workspaceId, chatId, runId } = validateRunIdParams(req.params);
    return getMessageRun(ctx, { workspaceId, chatId, runId });
  });

  app.delete('/workspaces/:workspaceId/chats/:chatId/runs/:runId', async (req) => {
    const { workspaceId, chatId, runId } = validateRunIdParams(req.params);
    return cancelMessageRun(ctx, { workspaceId, chatId, runId });
  });

  app.get('/workspaces/:workspaceId/chats/:chatId/runs/:runId/stream', async (req, reply) => {
    const { workspaceId, chatId, runId } = validateRunIdParams(req.params);
    const { afterSeq } = validateWatchRunQuery(req.query);
    const { stream } = await watchMessageRun(ctx, { workspaceId, chatId, runId, afterSeq });

    reply.hijack();

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    };
    reply.raw.writeHead(200, headers);

    // Closing this SSE stream only unsubscribes the watcher.
    // The background run keeps going; cancel explicitly via DELETE.
    stream.pipe(reply.raw);
    stream.on('error', (err) => {
      app.log.error({ err, runId }, 'run watch stream error');
      reply.raw.destroy(err);
    });
  });
}
