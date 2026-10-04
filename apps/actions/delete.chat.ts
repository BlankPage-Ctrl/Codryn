import type { Container } from '../bootstrap.js';

export async function deleteChat(
  ctx: Container,
  params: { workspaceId: string; id: string },
): Promise<void> {
  const chat = await ctx.chatService.findOne(params.id, params.workspaceId);
  if (!chat) {
    await ctx.chatService.delete(params.id, params.workspaceId);
    return;
  }
  await ctx.messagesService.clear(params.id);
  try {
    await ctx.fileHistoryStorage.deleteByChatId(params.id);
  } catch {
    // History cleanup is best effort; a leftover ledger row is harmless
    // (revert scope is resolved via live message ids).
  }
  try {
    const pendings = await ctx.hitlService.listPending();
    for (const p of pendings) {
      if (p.chatId === params.id) {
        try {
          await ctx.hitlService.cancel(p.id);
        } catch {
          // ignore per-request cancel failures (already resolved/expired)
        }
      }
    }
  } catch {
    // listPending failure should not block chat deletion
  }

  await ctx.chatService.delete(params.id, params.workspaceId);
}
