import type { Container } from '../bootstrap.js';
import { toChatDTO, type ChatDTO } from '../http/dto/chat.js';

export async function listChats(
  ctx: Container,
  params: { workspaceId: string },
): Promise<ChatDTO[]> {
  const chats = await ctx.chatService.findAllByWorkspace(params.workspaceId);
  return chats.map(toChatDTO);
}
