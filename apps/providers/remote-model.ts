import type { RemoteModelEntry } from './model-list.js';
import {
  openAICompatibleModelToCapability,
  openRouterModelToCapability,
} from './capabilities.js';

export interface RemoteModelCapabilities {
  reasoning: boolean | null;
  toolCalling: boolean | null;
  structuredOutput: boolean | null;
  vision: boolean | null;
  inputModalities: string[] | null;
  outputModalities: string[] | null;
}

/** Provider catalog row translated into the descriptor the desktop consumes. */
export interface RemoteModel {
  modelId: string;
  displayName: string | null;
  contextLength: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  capabilities: RemoteModelCapabilities | null;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function firstPositiveInt(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = positiveInt(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readBoolAt(value: unknown, path: string[]): boolean | null {
  return readBool(getPath(value, path));
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function pickDisplayName(entry: RecordValue): string | null {
  for (const field of ['name', 'friendly_name', 'display_name']) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function allCapabilitiesUnknown(capabilities: RemoteModelCapabilities): boolean {
  return (
    capabilities.reasoning === null &&
    capabilities.toolCalling === null &&
    capabilities.structuredOutput === null &&
    capabilities.vision === null &&
    capabilities.inputModalities === null &&
    capabilities.outputModalities === null
  );
}

function readCapabilities(entry: RecordValue): RemoteModelCapabilities | null {
  const explicit = isRecord(entry.capabilities) ? entry.capabilities : null;
  const architecture = isRecord(entry.architecture) ? entry.architecture : null;
  const modalities = isRecord(entry.modalities) ? entry.modalities : null;
  const params = stringArray(entry.supported_parameters);
  const parsedReasoning =
    openAICompatibleModelToCapability(entry) ?? openRouterModelToCapability(entry);

  const inputModalities =
    stringArray(architecture?.input_modalities) ??
    stringArray(modalities?.input) ??
    stringArray(explicit?.input_modalities);
  const outputModalities =
    stringArray(architecture?.output_modalities) ??
    stringArray(modalities?.output) ??
    stringArray(explicit?.output_modalities);

  const reasoning =
    readBoolAt(explicit, ['reasoning']) ??
    parsedReasoning?.reasoning ??
    readBool(entry.reasoning) ??
    (isRecord(entry.reasoning) ? true : null) ??
    (params ? params.includes('reasoning') : null);

  const toolCalling =
    readBoolAt(explicit, ['tool_calling']) ??
    readBoolAt(explicit, ['toolCalling']) ??
    readBoolAt(explicit, ['tools']) ??
    readBool(entry.tool_call) ??
    (params
      ? params.some((p) => p === 'tools' || p === 'tool_choice' || p === 'tool_calling')
      : null);

  const structuredOutput =
    readBoolAt(explicit, ['structured_output']) ??
    readBoolAt(explicit, ['structuredOutput']) ??
    readBool(entry.structured_output) ??
    (params
      ? params.some(
          (p) => p === 'structured_outputs' || p === 'structured_output' || p === 'response_format',
        )
      : null);

  const vision =
    readBoolAt(explicit, ['vision']) ??
    readBool(entry.vision) ??
    (inputModalities
      ? inputModalities.some((m) => m.toLowerCase() === 'image')
      : null) ??
    readBool(entry.attachment) ??
    readBoolAt(explicit, ['attachment']);

  const capabilities: RemoteModelCapabilities = {
    reasoning,
    toolCalling,
    structuredOutput,
    vision,
    inputModalities,
    outputModalities,
  };
  return allCapabilitiesUnknown(capabilities) ? null : capabilities;
}

export function toRemoteModel(entry: RemoteModelEntry): RemoteModel {
  const record = entry as RecordValue;
  const contextLength = firstPositiveInt(
    record.context_length,
    record.context_window,
    record.max_context_length,
    record.max_model_len,
    getPath(record, ['top_provider', 'context_length']),
    getPath(record, ['limit', 'context']),
  );
  const maxOutputTokens = firstPositiveInt(
    record.max_output_tokens,
    record.max_completion_tokens,
    record.output_token_limit,
    getPath(record, ['top_provider', 'max_completion_tokens']),
    getPath(record, ['limit', 'output']),
  );
  const explicitInput = firstPositiveInt(
    record.max_input_tokens,
    record.input_token_limit,
    getPath(record, ['limit', 'input']),
  );
  const derivedInput =
    contextLength !== null && maxOutputTokens !== null && contextLength > maxOutputTokens
      ? contextLength - maxOutputTokens
      : contextLength;

  return {
    modelId: String(entry.id),
    displayName: pickDisplayName(record),
    contextLength,
    maxInputTokens: explicitInput ?? derivedInput,
    maxOutputTokens,
    capabilities: readCapabilities(record),
  };
}

function mergeCapabilities(
  target: RemoteModelCapabilities | null,
  source: RemoteModelCapabilities | null,
): RemoteModelCapabilities | null {
  if (!target) return source;
  if (!source) return target;
  const merged: RemoteModelCapabilities = {
    reasoning: target.reasoning ?? source.reasoning,
    toolCalling: target.toolCalling ?? source.toolCalling,
    structuredOutput: target.structuredOutput ?? source.structuredOutput,
    vision: target.vision ?? source.vision,
    inputModalities: target.inputModalities ?? source.inputModalities,
    outputModalities: target.outputModalities ?? source.outputModalities,
  };
  return allCapabilitiesUnknown(merged) ? null : merged;
}

/** Fill missing fields from a second row without replacing known values. */
export function mergeRemoteModel(target: RemoteModel, source: RemoteModel): RemoteModel {
  return {
    modelId: target.modelId,
    displayName: target.displayName ?? source.displayName,
    contextLength: target.contextLength ?? source.contextLength,
    maxInputTokens: target.maxInputTokens ?? source.maxInputTokens,
    maxOutputTokens: target.maxOutputTokens ?? source.maxOutputTokens,
    capabilities: mergeCapabilities(target.capabilities, source.capabilities),
  };
}

/** Lookup keys for models.dev, ordered from most to least specific. */
export function modelIdCandidates(modelId: string): string[] {
  const candidates = new Set<string>([modelId]);
  let current = modelId;
  const suffixes = [/-\d{4}-\d{2}-\d{2}$/, /-\d{8}$/, /-\d{4}$/, /-latest$/, /-preview$/];
  for (const suffix of suffixes) {
    const next = current.replace(suffix, '');
    if (!next || next === current) continue;
    candidates.add(next);
    current = next;
  }
  return [...candidates];
}
