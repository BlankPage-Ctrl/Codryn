import { z } from 'zod';

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  projectPath: string;
  createdAt: Date;
  updatedAt: Date;
}

export const WorkspaceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    projectPath: z.string().min(1),
  })
  .strict();

export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateSchema>;

export const WorkspaceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    projectPath: z.string().min(1).optional(),
  })
  .strict();

export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateSchema>;
