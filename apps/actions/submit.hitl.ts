import type { Container } from '../bootstrap.js';
import type { HitlRequest, HitlResponse } from '../../src/human-in-the-loop/index.js';

export async function submitHitlResponse(
  ctx: Container,
  params: { id: string; response: unknown },
): Promise<HitlRequest> {
  return ctx.hitlService.submitResponse(params.id, params.response as HitlResponse);
}
