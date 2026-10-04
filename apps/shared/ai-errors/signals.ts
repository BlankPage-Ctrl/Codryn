// Provider payload parsing: OpenAI-shape, OpenRouter-shape, Responses-skin.
import { asNonEmptyString, asRecord } from './values.js';

/** Normalized provider signals extracted from APICallError data/body. */
export interface ProviderSignals {
  errorType: string | null;
  code: string | null;
  type: string | null;
  message: string | null;
  param: string | null;
}

export function parseProviderSignals(payload: unknown): ProviderSignals {
  const empty: ProviderSignals = {
    errorType: null,
    code: null,
    type: null,
    message: null,
    param: null,
  };
  const root = asRecord(payload);
  if (!root) return empty;
  // Responses skin carries error_type at the top level.
  const topErrorType = asNonEmptyString(root.error_type);
  // Canonical envelope: { error: { message, type?, code?, param?, metadata? } }.
  const envelope = asRecord(root.error) ?? root;
  const metadata = asRecord(envelope.metadata);
  const errorType =
    asNonEmptyString(metadata?.error_type) ?? asNonEmptyString(envelope.error_type) ?? topErrorType;
  const rawCode = envelope.code;
  return {
    errorType,
    code: typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : null,
    type: asNonEmptyString(envelope.type),
    message: asNonEmptyString(envelope.message),
    param: asNonEmptyString(envelope.param),
  };
}

export function haystackOf(signals: ProviderSignals, extra?: string | null): string {
  return [signals.errorType, signals.code, signals.type, signals.message, extra]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase();
}
