import type { Container } from '../bootstrap.js';
import type { HitlRequest } from '../../src/human-in-the-loop/index.js';

export async function listPendingHitl(ctx: Container): Promise<HitlRequest[]> {
  return ctx.hitlService.listPending();
}
