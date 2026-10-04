import type { Container } from '../bootstrap.js';

export async function cancelHitl(ctx: Container, params: { id: string }): Promise<void> {
  return ctx.hitlService.cancel(params.id);
}
