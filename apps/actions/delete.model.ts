import type { Container } from '../bootstrap.js';

export async function deleteModel(ctx: Container, params: { id: string }): Promise<void> {
  await ctx.providerService.removeModel(params.id);
}
