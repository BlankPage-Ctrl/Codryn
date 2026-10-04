import type { Container } from '../bootstrap.js';
import { toChatDTO, type ChatDTO } from '../http/dto/chat.js';
import { NotFoundError } from '../shared/errors.js';

export async function getChat(
  ctx: Container,
  params: { workspaceId: string; id: string },
): Promise<ChatDTO> {
  const chat = await ctx.chatService.findOne(params.id, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.id} not found`);
  return toChatDTO(chat);
}
