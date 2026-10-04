import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import { replayHistory, type FeedHistoryEvent } from '../shared/chat-feed/index.js';

export async function listMessages(
  ctx: Container,
  params: { workspaceId: string; chatId: string },
): Promise<FeedHistoryEvent[]> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  const thread = await ctx.messagesService.loadHistory(params.chatId);
  return replayHistory(thread, { chatId: params.chatId });
}
