import { z } from 'zod';

export const AskStepSchema = z.object({
  key: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2_000),
  placeholder: z.string().trim().max(200).optional(),
  validationRegex: z.string().trim().max(500).optional(),
  minLength: z.number().int().min(0).max(100_000).optional(),
  maxLength: z.number().int().min(1).max(100_000).optional(),
});
export type AskStep = z.infer<typeof AskStepSchema>;

export const AskPayloadSchema = z.object({
  placeholder: z.string().trim().max(200).optional(),
  validationRegex: z.string().trim().max(500).optional(),
  minLength: z.number().int().min(0).max(100_000).optional(),
  maxLength: z.number().int().min(1).max(100_000).optional(),
  allowClarification: z.boolean().optional(),
  wizard: z
    .object({
      steps: z.array(AskStepSchema).min(1).max(50),
    })
    .optional(),
});
export type AskPayload = z.infer<typeof AskPayloadSchema>;

export const AskResponseShape = z
  .object({
    value: z.string().trim().max(100_000),
  })
  .strict();

export type AskResponse = z.infer<typeof AskResponseShape>;

export interface AskResponseConstraints {
  minLength?: number;
  maxLength?: number;
  validationRegex?: string;
}

export function makeAskResponseSchema(constraints: AskResponseConstraints): z.ZodType<AskResponse> {
  return AskResponseShape.superRefine((data, ctx) => {
    const v = data.value;
    if (constraints.minLength !== undefined && v.length < constraints.minLength) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `value is shorter than minLength (${constraints.minLength})`,
      });
    }
    if (constraints.maxLength !== undefined && v.length > constraints.maxLength) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `value is longer than maxLength (${constraints.maxLength})`,
      });
    }
    if (constraints.validationRegex) {
      let rx: RegExp;
      try {
        rx = new RegExp(constraints.validationRegex);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'configured validationRegex is invalid',
        });
        return;
      }
      if (!rx.test(v)) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'value does not match the required format',
        });
      }
    }
  });
}
