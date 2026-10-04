export interface BusyRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 25;

function hasBusyCode(value: unknown, seen: Set<unknown>): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    return value.includes('SQLITE_BUSY');
  }
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.code === 'SQLITE_BUSY') return true;
  if (typeof record.message === 'string' && record.message.includes('SQLITE_BUSY')) {
    return true;
  }
  return (
    hasBusyCode(record.cause, seen) ||
    hasBusyCode(record.details, seen) ||
    hasBusyCode(record.error, seen)
  );
}

/** True when err is (or wraps) a SQLite SQLITE_BUSY failure. */
export function isBusyError(err: unknown): boolean {
  return hasBusyCode(err, new Set());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run fn, retrying transient SQLITE_BUSY failures with exponential backoff.
 * Any other error is rethrown immediately without retrying.
 */
export async function withBusyRetry<T>(
  fn: () => Promise<T>,
  options: BusyRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isBusyError(err) || attempt === attempts) throw err;
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
