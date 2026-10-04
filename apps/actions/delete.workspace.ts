import type { Container } from '../bootstrap.js';
import { resetWorkspaceSettings } from '../shared/workspace-settings.js';

export async function deleteWorkspace(ctx: Container, params: { id: string }): Promise<void> {
  await ctx.workspacesService.findOne(params.id);
  const chats = await ctx.chatService.findAllByWorkspace(params.id);

  for (const chat of chats) {
    await ctx.messagesService.clear(chat.id);
    try {
      await ctx.fileHistoryStorage.deleteByChatId(chat.id);
    } catch {
      // best effort; leftover ledger rows are harmless
    }
  }
  try {
    const pendings = await ctx.hitlService.listPending();
    const chatIds = new Set(chats.map((c) => c.id));
    for (const p of pendings) {
      const belongsToWorkspace = p.workspaceId === params.id;
      const belongsToChat = chatIds.has(p.chatId);
      if (belongsToWorkspace || belongsToChat) {
        try {
          await ctx.hitlService.cancel(p.id);
        } catch {
          // ignore per-request failures
        }
      }
    }
  } catch {
    // ignore listPending failure
  }

  for (const chat of chats) {
    await ctx.chatService.delete(chat.id, params.id);
  }

  await ctx.workspacesService.remove(params.id);
  try {
    await resetWorkspaceSettings(ctx, params.id);
  } catch (err) {
    ctx.logger?.warn?.(
      { err, workspaceId: params.id },
      'deleteWorkspace: resetWorkspaceSettings failed',
    );
  }
}
