import type { Container } from '../bootstrap.js';
import type { Model, ModelUpdateInput } from '../providers/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function updateModel(
  ctx: Container,
  params: { id: string; patch: ModelUpdateInput },
): Promise<Model> {
  try {
    return await ctx.providerService.updateModel(params.id, params.patch);
  } catch {
    throw new NotFoundError(`Model ${params.id} not found`);
  }
}
