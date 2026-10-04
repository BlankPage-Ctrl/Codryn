import type { Container } from '../bootstrap.js';
import type { Category } from '../../src/notes/index.js';

export async function listCategories(
  ctx: Container,
  params: { workspaceId: string },
): Promise<Category[]> {
  return ctx.categoriesService.list(params.workspaceId);
}
