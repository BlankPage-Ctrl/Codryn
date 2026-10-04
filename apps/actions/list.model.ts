import type { Container } from '../bootstrap.js';
import type { Model } from '../providers/index.js';

export async function listModels(ctx: Container, params: { providerId: string }): Promise<Model[]> {
  return ctx.providerService.findModelsByProviderId(params.providerId);
}
