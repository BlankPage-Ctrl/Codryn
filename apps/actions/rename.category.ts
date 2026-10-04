import type { Container } from '../bootstrap.js';
import type { Category } from '../../src/notes/index.js';
import { ValidationError } from '../shared/errors.js';

export async function renameCategory(
  ctx: Container,
  params: { workspaceId: string; id: string; name: string },
): Promise<Category> {
  try {
    return await ctx.categoriesService.rename(params.id, params.workspaceId, params.name);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}
