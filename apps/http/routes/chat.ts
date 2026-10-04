import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { listChats, getChat, createChat, updateChat, deleteChat } from '../../actions/index.js';
import {
  validateChatParams,
  validateWorkspaceId,
  validateCreateChat,
  validateUpdateChat,
} from '../../validators/chat.js';

export function registerChatRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:workspaceId/chats', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    return listChats(ctx, { workspaceId });
  });

  app.get('/workspaces/:workspaceId/chats/:id', async (req) => {
    const { workspaceId, id } = validateChatParams(req.params);
    return getChat(ctx, { workspaceId, id });
  });

  app.post('/workspaces/:workspaceId/chats', async (req, reply) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const input = validateCreateChat(req.body);
    const chat = await createChat(ctx, { workspaceId, ...input });
    return reply.code(201).send(chat);
  });

  app.patch('/workspaces/:workspaceId/chats/:id', async (req) => {
    const { workspaceId, id } = validateChatParams(req.params);
    const patch = validateUpdateChat(req.body);
    return updateChat(ctx, { workspaceId, id, ...patch });
  });

  app.delete('/workspaces/:workspaceId/chats/:id', async (req, reply) => {
    const { workspaceId, id } = validateChatParams(req.params);
    await deleteChat(ctx, { workspaceId, id });
    return reply.code(204).send();
  });
}
