import type { Container } from '../bootstrap.js';
import type { ChatRunSteps } from '../../src/messages/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function getChatUsage(
  ctx: Container,
  params: { workspaceId: string; chatId: string },
): Promise<ChatRunSteps> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  return ctx.messagesService.getUsageByChat(params.chatId);
}
