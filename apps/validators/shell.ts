import { z } from 'zod';

export const ApprovalIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const ApprovalDecisionSchema = z.enum(['allow', 'deny']);

export const DecideApprovalBodySchema = z.object({
  decision: ApprovalDecisionSchema,
});

export const DecideApprovalParamsSchema = ApprovalIdParamsSchema.extend({
  decision: ApprovalDecisionSchema,
});

export function validateApprovalId(params: unknown) {
  return ApprovalIdParamsSchema.parse(params);
}

export function validateDecideApproval(body: unknown) {
  return DecideApprovalBodySchema.parse(body);
}

export function validateDecideApprovalParams(params: unknown) {
  return DecideApprovalParamsSchema.parse(params);
}
