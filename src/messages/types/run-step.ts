import { z } from 'zod';
import type { RunStepRow, NewRunStepRow } from '../schemas/index.js';

export type { RunStepRow, NewRunStepRow };

export const RunStepFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
  'unknown',
]);

export type RunStepFinishReason = z.infer<typeof RunStepFinishReasonSchema>;

export interface RunStepToolCallSummary {
  toolCallId: string;
  toolName: string;
}

export const RecordRunStepSchema = z.object({
  messageId: z.string().min(1),
  chatId: z.string().min(1),
  runId: z.string().min(1),
  stepIndex: z.number().int().min(0),
  finishReason: RunStepFinishReasonSchema.nullable().optional(),
  inputTokens: z.number().int().min(0).nullable().optional(),
  outputTokens: z.number().int().min(0).nullable().optional(),
  totalTokens: z.number().int().min(0).nullable().optional(),
  modelId: z.string().max(255).nullable().optional(),
  providerMetadataJson: z.string().nullable().optional(),
  toolCallsJson: z.string().nullable().optional(),
  startedAtMs: z.number().int().min(0).nullable().optional(),
  finishedAtMs: z.number().int().min(0).nullable().optional(),
});

export type RecordRunStepInput = z.infer<typeof RecordRunStepSchema>;
