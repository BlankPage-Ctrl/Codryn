import type { Container } from '../bootstrap.js';
import type { MessageTokenUsage } from '../../src/messages/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function getMessageUsage(
  ctx: Container,
  params: { workspaceId: string; chatId: string; messageId: string },
): Promise<MessageTokenUsage> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  return ctx.messagesService.getUsageByMessage(params.messageId);
}
