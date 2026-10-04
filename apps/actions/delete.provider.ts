import type { Container } from '../bootstrap.js';

export async function deleteProvider(ctx: Container, params: { id: string }): Promise<void> {
  await ctx.providerService.remove(params.id);
}
