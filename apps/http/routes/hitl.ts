import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  requestHitl,
  submitHitlResponse,
  cancelHitl,
  getHitl,
  listPendingHitl,
  watchHitl,
} from '../../actions/index.js';
import {
  validateHitlId,
  validateHitlRequest,
  validateHitlResponse,
} from '../../validators/hitl.js';

export function registerHitlRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/hitl/requests/pending', async () => listPendingHitl(ctx));

  app.post('/hitl/requests', async (req) => {
    const input = validateHitlRequest(req.body);
    return requestHitl(ctx, input);
  });

  app.get('/hitl/requests/:id', async (req) => {
    const { id } = validateHitlId(req.params);
    return getHitl(ctx, { id });
  });

  app.post('/hitl/requests/:id/response', async (req) => {
    const { id, response } = validateHitlResponse(req.params, req.body);
    return submitHitlResponse(ctx, { id, response });
  });

  app.post('/hitl/requests/:id/cancel', async (req) => {
    const { id } = validateHitlId(req.params);
    await cancelHitl(ctx, { id });
    return { cancelled: true };
  });

  app.get('/hitl/requests/events', async (_req, reply) => {
    const { stream } = await watchHitl(ctx);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();

    stream.on('error', (err) => {
      app.log.error({ err }, 'hitl watch stream error');
      reply.raw.destroy(err);
    });
    reply.raw.on('close', () => stream.destroy());
    stream.pipe(reply.raw);
  });
}
