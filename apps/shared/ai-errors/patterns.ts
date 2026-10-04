// Regex semantic match on free-text haystacks (no HTTP status available).
// Used for plain Errors and unknown shapes.
import { fail, type MappedAiError } from './types.js';

export const LENGTH_RE =
  /context[_\s-]?length|too many tokens|max(imum)?[_\s-]?tokens?|token[_\s-]?limit|tokens? exceed|string[_\s-]?too[_\s-]?long|maximum context/;
export const FILTER_RE =
  /content[_\s-]?filter|moderation|refusal|content[_\s-]?policy|safety|guardrail|prompt[_\s-]?injection|blocked.*pattern|policy violat/;
export const RATE_RE = /rate[_\s-]?limit|slow[_\s-]?down|too many requests/;
export const BILLING_RE =
  /insufficient[_\s-]?quota|credit|spend[_\s-]?limit|usage[_\s-]?limit|billing|payment|out of credits|exceeds.*quota/;
export const AUTH_RE =
  /invalid[_\s-]?api[_\s-]?key|incorrect api key|unauthorized|authentication|invalid credentials|auth.*(fail|invalid|expired)|api key.*(missing|invalid|revoked|expired)/;
export const MODEL_MISSING_RE = /model.*not found|does not exist|no such model|unknown model/;
export const OVERLOAD_RE = /overload|capacity|try again later|server is (busy|overloaded)/;
export const NETWORK_RE =
  /fetch failed|network|econn|etimedout|enotfound|socket hang up|connection (reset|refused|aborted|closed)|cannot reach|could not connect|timeout|timed out/;

/** Returns null when nothing matches. */
export function mapSemanticHaystack(hay: string): MappedAiError | null {
  const text = hay.toLowerCase();
  if (text.length === 0) return null;
  if (LENGTH_RE.test(text)) {
    return fail(
      'CONTEXT_LENGTH_EXCEEDED',
      'The conversation exceeds the model context window. Shorten the input, clear old messages, or switch to a model with a larger context window.',
      400,
    );
  }
  if (FILTER_RE.test(text)) {
    return fail(
      'CONTENT_FILTERED',
      'The input or output was flagged by a content filter. Rephrase and retry.',
      400,
    );
  }
  if (RATE_RE.test(text)) {
    return fail(
      'RATE_LIMITED',
      'The provider rate limit was hit. Wait a moment and retry.',
      429,
      true,
    );
  }
  if (BILLING_RE.test(text)) {
    return fail(
      'PAYMENT_REQUIRED',
      'The provider account has insufficient credits or hit a spend limit. Add credits or raise the limit and retry.',
      402,
    );
  }
  if (AUTH_RE.test(text)) {
    return fail(
      'UNAUTHORIZED',
      'The provider rejected the API credentials. Check the API key configured for this provider.',
      401,
    );
  }
  if (MODEL_MISSING_RE.test(text)) {
    return fail(
      'MODEL_NOT_FOUND',
      'The requested model was not found on the provider. Check the model ID.',
      404,
    );
  }
  if (OVERLOAD_RE.test(text) || NETWORK_RE.test(text)) {
    return fail(
      'PROVIDER_UNAVAILABLE',
      'Cannot reach the provider or the provider is overloaded. Check the connection and retry.',
      502,
      true,
    );
  }
  return null;
}
