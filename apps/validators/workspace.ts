import { z } from 'zod';
import { WorkspaceCreateSchema, WorkspaceUpdateSchema } from '../../src/workspaces/index.js';

export const WorkspaceIdParamsSchema = z.object({
  id: z.string().min(1),
});

export function validateWorkspaceId(params: unknown) {
  return WorkspaceIdParamsSchema.parse(params);
}

export function validateCreateWorkspace(body: unknown) {
  return WorkspaceCreateSchema.parse(body);
}

export function validateUpdateWorkspace(body: unknown) {
  return WorkspaceUpdateSchema.parse(body);
}
