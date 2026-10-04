export const MAX_DETAIL_CHARS = 300;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function truncate(text: string, max = MAX_DETAIL_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function errorName(value: unknown): string | null {
  const record = asRecord(value);
  const name = record?.name;
  return typeof name === 'string' ? name : null;
}

export function isAbortError(value: unknown): boolean {
  if (value instanceof Error) return value.name === 'AbortError';
  return errorName(value) === 'AbortError';
}

/** Best-effort hunt for a human message in an unknown error shape. */
export function huntMessage(value: unknown, depth = 0): string | null {
  if (depth > 3 || value == null) return null;
  if (typeof value === 'string') return asNonEmptyString(value);
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['message', 'error', 'data', 'cause', 'responseBody']) {
    if (!(key in record)) continue;
    const found = huntMessage(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseJsonBody(body: string | undefined): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
