import type { Container } from '../bootstrap.js';
import type { ProviderWithModels } from '../providers/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function getProvider(
  ctx: Container,
  params: { id: string },
): Promise<ProviderWithModels> {
  try {
    return await ctx.providerService.findOne(params.id);
  } catch {
    throw new NotFoundError(`Provider ${params.id} not found`);
  }
}
