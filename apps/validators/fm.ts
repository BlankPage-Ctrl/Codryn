import { z } from 'zod';

export const WorkspaceIdParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export const ListDirQuerySchema = z.object({
  path: z.string().optional(),
});

export const GetStatQuerySchema = z.object({
  path: z.string().optional(),
});

export const ReadFileQuerySchema = z.object({
  path: z.string().optional(),
  maxBytes: z.coerce.number().int().positive().optional(),
});

export const SearchFilesQuerySchema = z.object({
  path: z.string().optional(),
  query: z.string().min(1),
  maxResults: z.coerce.number().int().positive().optional(),
  maxDepth: z.coerce.number().int().nonnegative().optional(),
});

export function validateWorkspaceId(params: unknown) {
  return WorkspaceIdParamsSchema.parse(params);
}

export function validateListDirQuery(query: unknown) {
  return ListDirQuerySchema.parse(query);
}

export function validateGetStatQuery(query: unknown) {
  return GetStatQuerySchema.parse(query);
}

export function validateReadFileQuery(query: unknown) {
  return ReadFileQuerySchema.parse(query);
}

export function validateSearchFilesQuery(query: unknown) {
  return SearchFilesQuerySchema.parse(query);
}
