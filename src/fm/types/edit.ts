import { z } from 'zod';

export const EditHintSchema = z
  .object({
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.startLine !== undefined && val.endLine !== undefined && val.startLine > val.endLine) {
      ctx.addIssue({
        code: 'custom',
        path: ['startLine'],
        message: 'startLine must be <= endLine',
      });
    }
  });

export type EditHint = z.infer<typeof EditHintSchema>;

export const EditOperationSchema = z
  .object({
    search: z.string().min(1, 'search must not be empty'),
    replace: z.string(),
    hint: EditHintSchema.optional(),
  })
  .strict();

export type EditOperation = z.infer<typeof EditOperationSchema>;

export const EditFileInputSchema = z
  .object({
    path: z.string().min(1, 'path must not be empty'),
    edits: z.array(EditOperationSchema).min(1, 'at least one edit required'),
    apply_order: z.enum(['reverse', 'forward']).default('reverse'),
  })
  .strict();

export type EditFileInput = z.infer<typeof EditFileInputSchema>;

export const EditFileDataSchema = z.object({
  path: z.string(),
  appliedEdits: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  content: z.string(),
  contentWithLineNumbers: z.string().optional(),
  encoding: z.enum(['utf-8', 'base64']),
  size: z.number().int().nonnegative(),
  diff: z.string().optional(),
  diffTruncated: z.boolean().optional(),
});

export type EditFileData = z.infer<typeof EditFileDataSchema>;

export const EditFailureReasonSchema = z.enum([
  'NOT_FOUND',
  'AMBIGUOUS',
  'NOT_FOUND_IN_HINT',
  'AMBIGUOUS_IN_HINT',
  'OVERLAP',
]);

export type EditFailureReason = z.infer<typeof EditFailureReasonSchema>;

export const EditMatchSchema = z.object({
  index: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  preview: z.string(),
});

export type EditMatch = z.infer<typeof EditMatchSchema>;

export const EditFailureDetailsSchema = z.object({
  editIndex: z.number().int().nonnegative(),
  reason: EditFailureReasonSchema,
  search: z.string(),
  searchPreview: z.string(),
  hint: EditHintSchema.optional(),
  expandedRange: z
    .object({
      start: z.number().int().positive(),
      end: z.number().int().positive(),
    })
    .optional(),
  matches: z.array(EditMatchSchema),
  allMatchesOutsideHint: z.array(EditMatchSchema).optional(),
  overlappingWith: z.number().int().nonnegative().optional(),
  totalEdits: z.number().int().positive(),
});

export type EditFailureDetails = z.infer<typeof EditFailureDetailsSchema>;
