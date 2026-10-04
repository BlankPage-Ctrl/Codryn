import type { Container } from '../bootstrap.js';
import type { ProviderTypeInfo } from '../providers/index.js';

export async function listProviderTypes(ctx: Container): Promise<ProviderTypeInfo[]> {
  return ctx.providerService.listProviderTypes();
}
