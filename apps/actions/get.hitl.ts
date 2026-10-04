import type { Container } from '../bootstrap.js';
import type { HitlRequest } from '../../src/human-in-the-loop/index.js';

export async function getHitl(ctx: Container, params: { id: string }): Promise<HitlRequest | null> {
  return ctx.hitlService.getById(params.id);
}
