import { z } from 'zod';

export const InsightWorkspaceParamsSchema = z.object({
  id: z.string().min(1),
});

export function validateInsightWorkspaceParams(params: unknown) {
  return InsightWorkspaceParamsSchema.parse(params);
}

export const InsightSyncBodySchema = z.object({}).strict();

export function validateInsightSync(body: unknown) {
  return InsightSyncBodySchema.parse(body ?? {});
}

export const InsightIndexBodySchema = z.object({
  force: z.boolean().optional(),
});

export function validateInsightIndex(body: unknown) {
  return InsightIndexBodySchema.parse(body ?? {});
}

export const InsightSearchModeSchema = z.enum(['auto', 'exact', 'prefix', 'substring', 'fts']);

export const InsightSearchQuerySchema = z.object({
  query: z.string().min(1),
  mode: InsightSearchModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  file: z.string().optional(),
  container: z.string().optional(),
});

export function validateInsightSearch(query: unknown) {
  return InsightSearchQuerySchema.parse(query);
}
