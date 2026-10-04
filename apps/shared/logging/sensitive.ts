import { SENSITIVE_FLAG } from './types.js';

/**
 * Keys matching this pattern are auto-redacted in every sink
 * (local files AND telemetry). Extends the MCP elicitation guard.
 */
export const SENSITIVE_RE =
  /password|passwd|token|secret|api[-_ ]?key|credential|private[-_ ]?key|authorization|secretkey|clientsecret/i;

export const REDACTED = '[REDACTED]';

const SENSITIVE_MARK = Symbol.for('app.logger.sensitive');

export function markSensitive<T extends object>(obj: T): T {
  Object.defineProperty(obj, SENSITIVE_MARK, {
    value: true,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return obj;
}

export function isMarkedSensitive(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  if ((obj as Record<PropertyKey, unknown>)[SENSITIVE_MARK] === true) return true;
  return (obj as Record<string, unknown>)[SENSITIVE_FLAG] === true;
}

export interface RedactResult {
  value: unknown;
  redactedKeys: string[];
}

/**
 * Deep-clone `input` replacing values of sensitive keys with `[REDACTED]`.
 * Handles plain objects, arrays, and nested structures. Cycle-safe.
 * Error instances are left untouched (serialize-error.ts handles them).
 */
export function redact(input: unknown, seen = new WeakMap<object, unknown>()): RedactResult {
  const redactedKeys: string[] = [];
  const value = redactInto(input, redactedKeys, seen);
  return { value, redactedKeys };
}

function redactInto(
  input: unknown,
  redactedKeys: string[],
  seen: WeakMap<object, unknown>,
): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (typeof input !== 'object') return input;
  if (input instanceof Error) return input;
  if (input instanceof Uint8Array) return '[binary]';
  if (input instanceof ArrayBuffer) return '[binary]';

  const cached = seen.get(input as object);
  if (cached !== undefined) return cached;

  if (Array.isArray(input)) {
    const out: unknown[] = [];
    seen.set(input, out);
    for (const item of input) out.push(redactInto(item, redactedKeys, seen));
    return out;
  }

  const out: Record<string, unknown> = {};
  seen.set(input as object, out);
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (key === SENSITIVE_FLAG) {
      out[key] = val;
      continue;
    }
    if (SENSITIVE_RE.test(key)) {
      redactedKeys.push(key);
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactInto(val, redactedKeys, seen);
  }
  return out;
}

/**
 * Build the telemetry-safe payload: redact sensitive keys first,
 * then report whether the record must be dropped entirely.
 */
export function toTelemetrySafe(obj: unknown): {
  drop: boolean;
  payload: unknown;
  redactedKeys: string[];
} {
  if (isMarkedSensitive(obj)) return { drop: true, payload: undefined, redactedKeys: [] };
  const { value, redactedKeys } = redact(obj);
  return { drop: false, payload: value, redactedKeys };
}
