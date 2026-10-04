import { z } from 'zod';

export const RunParamsSchema = z.object({
  workspaceId: z.string().min(1),
  chatId: z.string().min(1),
});

export const RunIdParamsSchema = RunParamsSchema.extend({
  runId: z.string().min(1),
});

export const WatchRunQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional().default(0),
});

export function validateRunParams(params: unknown) {
  return RunParamsSchema.parse(params);
}

export function validateRunIdParams(params: unknown) {
  return RunIdParamsSchema.parse(params);
}

export function validateWatchRunQuery(query: unknown) {
  return WatchRunQuerySchema.parse(query ?? {});
}
