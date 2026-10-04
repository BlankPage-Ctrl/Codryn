import type { Container } from '../bootstrap.js';

export async function deleteNote(
  ctx: Container,
  params: { workspaceId: string; id: string },
): Promise<void> {
  await ctx.notesService.delete(params.id, params.workspaceId);
}
