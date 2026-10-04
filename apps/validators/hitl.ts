import { z } from 'zod';
import { HitlRequestInputSchema } from '../../src/human-in-the-loop/index.js';

export const HitlIdParamsSchema = z.object({ id: z.string().min(1) });

export const HitlResponseBodySchema = z
  .object({
    response: z.unknown(),
  })
  .strict();

export function validateHitlId(params: unknown) {
  return HitlIdParamsSchema.parse(params);
}

export function validateHitlRequest(body: unknown) {
  return HitlRequestInputSchema.parse(body);
}

export function validateHitlResponse(params: unknown, body: unknown) {
  const { id } = HitlIdParamsSchema.parse(params);
  const { response } = HitlResponseBodySchema.parse(body);
  return { id, response };
}
