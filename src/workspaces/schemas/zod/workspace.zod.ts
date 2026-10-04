import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { workspaces } from '../workspace.js';

export const workspaceInsertSchema = createInsertSchema(workspaces);
export const workspaceSelectSchema = createSelectSchema(workspaces);
export const workspaceUpdateSchema = createUpdateSchema(workspaces);
