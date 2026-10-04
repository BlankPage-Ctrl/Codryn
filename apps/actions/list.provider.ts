import type { Container } from '../bootstrap.js';
import type { ProviderWithModels } from '../providers/index.js';

export async function listProviders(ctx: Container): Promise<ProviderWithModels[]> {
  return ctx.providerService.findAll();
}
