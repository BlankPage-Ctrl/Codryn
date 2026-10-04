import type { Container } from '../bootstrap.js';
import type { LlmProviderUpdateInput, ProviderWithModels } from '../providers/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function updateProvider(
  ctx: Container,
  params: { id: string; patch: LlmProviderUpdateInput },
): Promise<ProviderWithModels> {
  try {
    await ctx.providerService.update(params.id, params.patch);
    return await ctx.providerService.findOne(params.id);
  } catch {
    throw new NotFoundError(`Provider ${params.id} not found`);
  }
}
