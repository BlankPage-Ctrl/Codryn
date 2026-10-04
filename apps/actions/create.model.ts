import type { Container } from '../bootstrap.js';
import type { Model, ModelCreateInput } from '../providers/index.js';
import { ValidationError } from '../shared/errors.js';

export async function createModel(
  ctx: Container,
  params: { providerId: string; input: Omit<ModelCreateInput, 'providerId'> },
): Promise<Model> {
  try {
    return await ctx.providerService.createModel({
      ...params.input,
      providerId: params.providerId,
    });
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}
