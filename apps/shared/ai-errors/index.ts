/* The Vercel AI SDK normalizes transport (typed APICallError with
 * statusCode/responseBody/data) but i think its NOT semantics: provider-specific codes
 * (OpenAI `type`/`code`, OpenRouter `metadata.error_type`) pass through raw.
 * This module converts those into stable, user-facing { code, message }
 * pairs for the chat feed (`oops`), run records, and logs.
 */

export { fail, type MapAiErrorOptions, type MappedAiError } from './types.js';
export {
  MAX_DETAIL_CHARS,
  asNonEmptyString,
  asRecord,
  errorName,
  huntMessage,
  isAbortError,
  parseJsonBody,
  truncate,
} from './values.js';
export { haystackOf, parseProviderSignals, type ProviderSignals } from './signals.js';
export { mapOpenRouterErrorType } from './openrouter.js';
export {
  AUTH_RE,
  BILLING_RE,
  FILTER_RE,
  LENGTH_RE,
  MODEL_MISSING_RE,
  NETWORK_RE,
  OVERLOAD_RE,
  RATE_RE,
  mapSemanticHaystack,
} from './patterns.js';
export { mapApiCallError } from './api-call.js';
export { mapAiError } from './mapper.js';
