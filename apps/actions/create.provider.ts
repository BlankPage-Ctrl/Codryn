import type { Container } from '../bootstrap.js';
import type { LlmProviderCreateInput, ProviderWithModels } from '../providers/index.js';

export async function createProvider(
  ctx: Container,
  params: LlmProviderCreateInput,
): Promise<ProviderWithModels> {
  const provider = await ctx.providerService.create(params);
  const found = await ctx.providerService.findOne(provider.id);
  return found;
}
