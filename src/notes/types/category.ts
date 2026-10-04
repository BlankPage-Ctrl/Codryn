import { z } from 'zod';

export interface Category {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  is_default: boolean;
  created_at: Date;
}

export const CategoryCreateSchema = z
  .object({
    workspace_id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(40),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export type CategoryCreateInput = z.infer<typeof CategoryCreateSchema>;
