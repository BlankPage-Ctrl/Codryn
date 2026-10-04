import { z } from 'zod';

export const ChoiceModeSchema = z.enum(['single', 'multi', 'ranked']);
export type ChoiceMode = z.infer<typeof ChoiceModeSchema>;

export const ChoiceOptionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  recommended: z.boolean().optional(),
  allowCustomInput: z.boolean().optional(),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

export const ChoicePayloadSchema = z.object({
  mode: ChoiceModeSchema,
  options: z.array(ChoiceOptionSchema).min(1).max(100),
  defaultSelection: z.array(z.string().trim().min(1)).max(100).optional(),
  minSelect: z.number().int().min(1).max(100).optional(),
  maxSelect: z.number().int().min(1).max(100).optional(),
  allowOther: z.boolean().optional(),
});
export type ChoicePayload = z.infer<typeof ChoicePayloadSchema>;

export const ChoiceResponseShape = z
  .object({
    selected: z.array(z.string().trim().min(1)).min(1),
    customInput: z.string().trim().max(100_000).optional(),
  })
  .strict();

export type ChoiceResponse = z.infer<typeof ChoiceResponseShape>;

export interface ChoiceResponseContext {
  mode: ChoiceMode;
  optionIds: string[];
  minSelect?: number;
  maxSelect?: number;
  allowOther?: boolean;
}

export function makeChoiceResponseSchema(ctx: ChoiceResponseContext): z.ZodType<ChoiceResponse> {
  return ChoiceResponseShape.superRefine((data, c) => {
    const { mode, optionIds, minSelect, maxSelect } = ctx;

    if (mode === 'single' && data.selected.length !== 1) {
      c.addIssue({
        code: 'custom',
        path: ['selected'],
        message: 'single-select requires exactly one selection',
      });
    }
    if (mode === 'multi' || mode === 'ranked') {
      if (minSelect !== undefined && data.selected.length < minSelect) {
        c.addIssue({
          code: 'custom',
          path: ['selected'],
          message: `at least ${minSelect} selection(s) required`,
        });
      }
      if (maxSelect !== undefined && data.selected.length > maxSelect) {
        c.addIssue({
          code: 'custom',
          path: ['selected'],
          message: `at most ${maxSelect} selection(s) allowed`,
        });
      }
    }
    if (mode === 'ranked') {
      const known = data.selected.filter((id) => optionIds.includes(id));
      if (known.length !== data.selected.length) {
        c.addIssue({
          code: 'custom',
          path: ['selected'],
          message: 'ranked selection contains unknown option ids',
        });
      }
    }
  });
}
