import type { Container } from '../bootstrap.js';
import type { Category } from '../../src/notes/index.js';

export async function createCategory(
  ctx: Container,
  params: { workspaceId: string; name: string; color?: string },
): Promise<Category> {
  return ctx.categoriesService.create(params.workspaceId, {
    name: params.name,
    color: params.color,
  });
}
