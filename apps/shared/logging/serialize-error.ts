import { hostname } from 'node:os';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  errno?: number | string;
  syscall?: string;
  path?: string;
  status?: number;
  statusCode?: number;
  data?: unknown;
  details?: unknown;
  cause?: SerializedError | unknown;
  errors?: SerializedError[];
  proc: { pid: number; hostname: string; node: string };
}

function procContext(): SerializedError['proc'] {
  let host = 'unknown';
  try {
    host = hostname();
  } catch {
    // ignore
  }
  return { pid: process.pid, hostname: host, node: process.version };
}

/** Full-fidelity error serializer: keeps stack + cause chain + system fields. */
export function toLoggableError(
  err: unknown,
  seen = new WeakSet<object>(),
): SerializedError | unknown {
  if (err === null || err === undefined) return err;
  if (typeof err !== 'object') return err;
  if (!(err instanceof Error)) {
    // Plain object carrying error-ish shape - return as-is, caller redacts keys.
    return err;
  }
  if (seen.has(err)) return { name: err.name, message: '[circular]', proc: procContext() };
  seen.add(err);

  const e = err as unknown as Record<string, unknown>;
  const out: SerializedError = {
    name: typeof e['name'] === 'string' ? (e['name'] as string) : 'Error',
    message: typeof e['message'] === 'string' ? (e['message'] as string) : String(err),
    proc: procContext(),
  };

  if (typeof err.stack === 'string') out.stack = err.stack;
  if (typeof e['code'] === 'string' || typeof e['code'] === 'number') out.code = String(e['code']);
  if (typeof e['errno'] === 'string' || typeof e['errno'] === 'number')
    out.errno = e['errno'] as number | string;
  if (typeof e['syscall'] === 'string') out.syscall = e['syscall'] as string;
  if (typeof e['path'] === 'string') out.path = e['path'] as string;
  if (typeof e['status'] === 'number') out.status = e['status'] as number;
  if (typeof e['statusCode'] === 'number') out.statusCode = e['statusCode'] as number;
  if (e['data'] !== undefined) out.data = safeValue(e['data']);
  if (e['details'] !== undefined) out.details = safeValue(e['details']);

  // AggregateError.errors
  if (Array.isArray(e['errors'])) {
    out.errors = (e['errors'] as unknown[]).map(
      (inner) => toLoggableError(inner, seen) as SerializedError,
    );
  }

  // cause chain (Error.cause, VError-style .cause(), or .reason)
  const cause = (e as { cause?: unknown })['cause'];
  if (cause !== undefined) {
    out.cause =
      typeof cause === 'function'
        ? safeValue((cause as () => unknown).call(err))
        : toLoggableError(cause, seen);
  } else if (typeof (e as { reason?: unknown })['reason'] !== 'undefined') {
    out.cause = toLoggableError((e as { reason?: unknown })['reason'], seen);
  }

  // Copy other enumerable own props that are JSON-safe (e.g. AppError.code already handled,
  // domain errors may carry errorCode, issues, meta).
  for (const key of ['errorCode', 'issues', 'meta', 'info'] as const) {
    if (e[key] !== undefined && !(key in (out as unknown as Record<string, unknown>))) {
      (out as unknown as Record<string, unknown>)[key] = safeValue(e[key]);
    }
  }

  return out;
}

function safeValue(v: unknown): unknown {
  try {
    // structuredClone fails on functions/symbols - fall back to JSON-safe copy.
    if (typeof v === 'object' && v !== null) {
      JSON.stringify(v);
      return v;
    }
    return v;
  } catch {
    return String(v);
  }
}

/** Normalize logger's (obj, msg?) args into { fields, msg }. */
export function normalizeArgs(
  obj: unknown,
  msg?: string,
): { fields: Record<string, unknown>; msg: string } {
  if (typeof obj === 'string') {
    return { fields: {}, msg: msg !== undefined ? `${obj} ${msg}` : obj };
  }
  if (obj === null || obj === undefined) {
    return { fields: {}, msg: msg ?? '' };
  }
  if (typeof obj !== 'object') {
    return { fields: { value: obj }, msg: msg ?? '' };
  }
  const fields = { ...(obj as Record<string, unknown>) };
  // Serialize any Error values found at top level (err, error, cause).
  for (const key of ['err', 'error', 'cause'] as const) {
    if (fields[key] !== undefined) {
      fields[key] = toLoggableError(fields[key]);
    }
  }
  return { fields, msg: msg ?? '' };
}
