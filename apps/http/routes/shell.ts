import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { killShellExec, watchShellExec } from '../../actions/index.js';
import { validateWorkspaceId } from '../../validators/fm.js';
import { validateShellExecutionId } from '../../validators/shell.js';

export function registerShellRoutes(app: FastifyInstance, ctx: Container) {
  // app.get('/shell/approvals/pending', async () => listPendingApprovals(ctx));
  // app.post('/shell/approvals/:id', async (req) => {
  //   const { id } = validateApprovalId(req.params);
  //   const { decision } = validateDecideApproval(req.body);
  //   return decideApproval(ctx, { id, decision });
  // });

  app.delete('/shell/executions/:executionId', async (req) => {
    const { executionId } = validateShellExecutionId(req.params);
    return killShellExec(ctx, { executionId });
  });

  app.get('/workspaces/:workspaceId/shell/events', async (req, reply) => {
    const { workspaceId } = validateWorkspaceId(req.params);

    const { stream } = await watchShellExec(ctx, { workspaceId });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();

    stream.on('error', (err) => {
      app.log.error({ err }, 'shell exec sse error');
      reply.raw.destroy(err);
    });
    reply.raw.on('close', () => stream.destroy());
    stream.pipe(reply.raw);
  });
}
