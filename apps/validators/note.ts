import { z } from 'zod';
import {
  NoteCreateSchema,
  NoteUpdateSchema,
  MovePositionSchema,
  CategoryCreateSchema,
} from '../../src/notes/index.js';

export const WorkspaceIdParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export const NoteIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const NoteParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

export const CategoryParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

export const ListNotesQuerySchema = z.object({
  category: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['rank', 'priority', 'updated_at', 'created_at', 'name']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const RenameCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(40),
  })
  .strict();

export function validateWorkspaceId(params: unknown) {
  return WorkspaceIdParamsSchema.parse(params);
}

export function validateNoteId(params: unknown) {
  return NoteIdParamsSchema.parse(params);
}

export function validateNoteParams(params: unknown) {
  return NoteParamsSchema.parse(params);
}

export function validateCategoryParams(params: unknown) {
  return CategoryParamsSchema.parse(params);
}

export function validateListNotesQuery(query: unknown) {
  return ListNotesQuerySchema.parse(query);
}

export function validateCreateNote(body: unknown) {
  // workspace_id injected from route param, omit from body validation
  return NoteCreateSchema.omit({ workspace_id: true }).parse(body);
}

export function validateUpdateNote(body: unknown) {
  return NoteUpdateSchema.parse(body);
}

export function validateMoveNote(body: unknown) {
  return MovePositionSchema.parse(body);
}

export function validateCreateCategory(body: unknown) {
  return CategoryCreateSchema.omit({ workspace_id: true }).parse(body);
}

export function validateRenameCategory(body: unknown) {
  return RenameCategorySchema.parse(body);
}
