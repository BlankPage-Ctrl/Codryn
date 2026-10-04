import type { Container } from '../bootstrap.js';

export async function renumberNotes(
  ctx: Container,
  params: { workspaceId: string },
): Promise<{ ok: true }> {
  await ctx.notesService.renumber(params.workspaceId);
  return { ok: true };
}
