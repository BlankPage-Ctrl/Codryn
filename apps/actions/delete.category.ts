import type { Container } from '../bootstrap.js';

export async function deleteCategory(
  ctx: Container,
  params: { workspaceId: string; id: string },
): Promise<void> {
  const cat = await ctx.categoriesService.findById(params.id, params.workspaceId);
  if (!cat) {
    await ctx.categoriesService.delete(params.id, params.workspaceId);
    return;
  }
  if (cat.is_default) {
    await ctx.categoriesService.delete(params.id, params.workspaceId);
    return;
  }

  const defaultCat = await ctx.categoriesService.ensureDefault(params.workspaceId);
  if (defaultCat.id !== params.id) {
    await ctx.notesService.reassignCategory(params.id, defaultCat.id, params.workspaceId);
  }

  await ctx.categoriesService.delete(params.id, params.workspaceId);
}
