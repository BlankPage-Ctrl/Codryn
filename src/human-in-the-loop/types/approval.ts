import { z } from 'zod';

export const ApprovalOutcomeSchema = z.enum([
  'approved',
  'rejected',
  'always_approved',
  'approved_with_modification',
]);
export type ApprovalOutcome = z.infer<typeof ApprovalOutcomeSchema>;

export const ApprovalPayloadSchema = z.object({
  contextPreview: z.unknown().optional(),
  modification: z
    .object({
      initialValue: z.string().max(5_000),
      label: z.string().trim().max(100).optional(),
      placeholder: z.string().trim().max(200).optional(),
    })
    .optional(),
  requireReasonOnReject: z.boolean().optional(),
});
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>;

export const ApprovalResponseSchema = z
  .object({
    outcome: ApprovalOutcomeSchema,
    modificationNote: z.string().trim().max(5_000).optional(),
    reason: z.string().trim().max(5_000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.outcome === 'approved_with_modification' && !data.modificationNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['modificationNote'],
        message: 'modificationNote is required when outcome is approved_with_modification',
      });
    }
    if (data.outcome === 'rejected' && data.modificationNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['modificationNote'],
        message: 'modificationNote must not be set on a plain reject',
      });
    }
  });
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
