import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../actions/index.js';
import {
  validateWorkspaceId,
  validateCreateWorkspace,
  validateUpdateWorkspace,
} from '../../validators/workspace.js';

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces', async () => listWorkspaces(ctx));

  app.get('/workspaces/:id', async (req) => {
    const { id } = validateWorkspaceId(req.params);
    return getWorkspace(ctx, { id });
  });

  app.post('/workspaces', async (req, reply) => {
    const input = validateCreateWorkspace(req.body);
    const ws = await createWorkspace(ctx, input);
    return reply.code(201).send(ws);
  });

  app.patch('/workspaces/:id', async (req) => {
    const { id } = validateWorkspaceId(req.params);
    const patch = validateUpdateWorkspace(req.body);
    return updateWorkspace(ctx, { id, patch });
  });

  app.delete('/workspaces/:id', async (req, reply) => {
    const { id } = validateWorkspaceId(req.params);
    await deleteWorkspace(ctx, { id });
    return reply.code(204).send();
  });
}
