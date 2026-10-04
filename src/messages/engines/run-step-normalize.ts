import type { RunStepFinishReason, RunStepToolCallSummary } from '../types/run-step.js';

export interface RawStepFinishEvent {
  finishReason?: unknown;
  usage?: unknown;
  toolCalls?: unknown;
  response?: unknown;
  providerMetadata?: unknown;
}

export interface NormalizedStepFinish {
  finishReason: RunStepFinishReason | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  modelId: string | null;
  providerMetadataJson: string | null;
  toolCallsJson: string | null;
}

const KNOWN_FINISH_REASONS: ReadonlySet<string> = new Set([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
  'unknown',
]);

const MAX_TOOL_CALL_SUMMARIES = 50;

function toNonNegInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeFinishReason(value: unknown): RunStepFinishReason | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (KNOWN_FINISH_REASONS.has(value)) return value as RunStepFinishReason;
  return 'other';
}

function normalizeUsage(usage: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const record = asRecord(usage);
  if (!record) return { inputTokens: null, outputTokens: null, totalTokens: null };
  const inputTokens = toNonNegInt(record.inputTokens) ?? toNonNegInt(record.promptTokens);
  const outputTokens = toNonNegInt(record.outputTokens) ?? toNonNegInt(record.completionTokens);
  const totalTokens =
    toNonNegInt(record.totalTokens) ??
    (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);
  return { inputTokens, outputTokens, totalTokens };
}

function normalizeToolCalls(toolCalls: unknown): string | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const summaries: RunStepToolCallSummary[] = [];
  for (const entry of toolCalls.slice(0, MAX_TOOL_CALL_SUMMARIES)) {
    const record = asRecord(entry);
    if (!record) continue;
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : '';
    const toolName = typeof record.toolName === 'string' ? record.toolName : '';
    if (!toolCallId && !toolName) continue;
    summaries.push({ toolCallId, toolName });
  }
  if (summaries.length === 0) return null;
  try {
    return JSON.stringify(summaries);
  } catch {
    return null;
  }
}

function normalizeModelId(response: unknown): string | null {
  const record = asRecord(response);
  if (!record) return null;
  const modelId = record.modelId;
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  return modelId.slice(0, 255);
}

function toJsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function normalizeStepFinish(event: RawStepFinishEvent): NormalizedStepFinish {
  const { inputTokens, outputTokens, totalTokens } = normalizeUsage(event.usage);
  return {
    finishReason: normalizeFinishReason(event.finishReason),
    inputTokens,
    outputTokens,
    totalTokens,
    modelId: normalizeModelId(event.response),
    providerMetadataJson: toJsonOrNull(event.providerMetadata),
    toolCallsJson: normalizeToolCalls(event.toolCalls),
  };
}
