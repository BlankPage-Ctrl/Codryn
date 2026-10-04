import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  listMessages,
  revertMessageRun,
  previewMessageRun,
  getChatUsage,
  getMessageUsage,
} from '../../actions/index.js';
import {
  validateMessageParams,
  validateMessageUsageParams,
  validateRevertMessage,
  validateRevertPreview,
} from '../../validators/message.js';

export function registerMessageRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:workspaceId/chats/:chatId/messages', async (req) => {
    const { workspaceId, chatId } = validateMessageParams(req.params);
    return listMessages(ctx, { workspaceId, chatId });
  });

  app.get('/workspaces/:workspaceId/chats/:chatId/usage', async (req) => {
    const { workspaceId, chatId } = validateMessageParams(req.params);
    return getChatUsage(ctx, { workspaceId, chatId });
  });

  app.get('/workspaces/:workspaceId/chats/:chatId/messages/:messageId/usage', async (req) => {
    const { workspaceId, chatId, messageId } = validateMessageUsageParams(req.params);
    return getMessageUsage(ctx, { workspaceId, chatId, messageId });
  });

  app.post('/workspaces/:workspaceId/chats/:chatId/revert', async (req) => {
    const { workspaceId, chatId } = validateMessageParams(req.params);
    const input = validateRevertMessage(req.body);
    return revertMessageRun(ctx, {
      workspaceId,
      chatId,
      messageId: input.messageId,
      mode: input.mode,
      restoreFiles: input.restoreFiles,
    });
  });

  app.post('/workspaces/:workspaceId/chats/:chatId/revert/preview', async (req) => {
    const { workspaceId, chatId } = validateMessageParams(req.params);
    const input = validateRevertPreview(req.body);
    return previewMessageRun(ctx, {
      workspaceId,
      chatId,
      messageId: input.messageId,
      mode: input.mode,
    });
  });
}
