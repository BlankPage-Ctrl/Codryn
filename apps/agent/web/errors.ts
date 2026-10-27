export type WebErrorCode =
  | 'DISABLED'
  | 'INVALID_URL'
  | 'SSRF_BLOCKED'
  | 'OFFLINE'
  | 'CANCELLED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'HTTP_STATUS'
  | 'BLOCKED'
  | 'RATE_LIMITED'
  | 'BLOCKED_BY_SITE'
  | 'PARSE_FAILED'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'NO_PROVIDER_AVAILABLE'
  | 'ENGINES_EXHAUSTED'
  | 'ALL_PROVIDERS_FAILED';

export interface WebError extends Error {
  name: 'WebError';
  code: WebErrorCode;
  statusCode: number;
  metadata?: Record<string, unknown>;
}

export interface WebErrorInit {
  statusCode?: number;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

// Retryable failures stop a provider/engine from being asked again until the
// cooldown expires, so one blocked upstream cannot eat the whole time budget.
export const WEB_RETRYABLE_CODES: ReadonlySet<WebErrorCode> = new Set<WebErrorCode>([
  'BLOCKED',
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'HTTP_STATUS',
  'PARSE_FAILED',
  'ENGINES_EXHAUSTED',
]);

const DEFAULT_STATUS: Record<WebErrorCode, number> = {
  DISABLED: 409,
  INVALID_URL: 400,
  SSRF_BLOCKED: 403,
  OFFLINE: 503,
  CANCELLED: 499,
  NETWORK: 502,
  TIMEOUT: 504,
  HTTP_STATUS: 502,
  BLOCKED: 429,
  RATE_LIMITED: 429,
  BLOCKED_BY_SITE: 403,
  PARSE_FAILED: 502,
  TOO_LARGE: 413,
  TOO_MANY_REDIRECTS: 502,
  UNSUPPORTED_CONTENT_TYPE: 415,
  NO_PROVIDER_AVAILABLE: 503,
  ENGINES_EXHAUSTED: 502,
  ALL_PROVIDERS_FAILED: 502,
};

export function webError(code: WebErrorCode, message: string, init: WebErrorInit = {}): WebError {
  const err = new Error(
    message,
    init.cause === undefined ? undefined : { cause: init.cause },
  ) as WebError;
  err.name = 'WebError';
  err.code = code;
  err.statusCode = init.statusCode ?? DEFAULT_STATUS[code];
  if (init.metadata) err.metadata = init.metadata;
  return err;
}

export function isWebError(err: unknown): err is WebError {
  return err instanceof Error && err.name === 'WebError' && 'code' in err;
}

export function webErrorMetadata(err: WebError): Record<string, unknown> {
  return err.metadata ?? {};
}
