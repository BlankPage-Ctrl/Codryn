import type { Container } from '../bootstrap.js';
import type { HitlRequest, HitlRequestInput } from '../../src/human-in-the-loop/index.js';

export async function requestHitl(ctx: Container, params: HitlRequestInput): Promise<HitlRequest> {
  return ctx.hitlService.request(params);
}
