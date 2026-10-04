import { z } from 'zod';

export const CreateFileInputSchema = z
  .object({
    path: z.string().min(1, 'path must not be empty').max(1024, 'path too long'),
    content: z.string().max(200_000, 'content too large (max 200k chars)'),
    overwrite: z.boolean().default(false),
  })
  .strict();

export type CreateFileInput = z.infer<typeof CreateFileInputSchema>;

export const CreateFileDataSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  content: z.string(),
  contentWithLineNumbers: z.string().optional(),
  encoding: z.enum(['utf-8']),
});

export type CreateFileData = z.infer<typeof CreateFileDataSchema>;
