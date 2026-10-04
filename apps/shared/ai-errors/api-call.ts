// APICallError branch: typed vocabulary first, then status + haystack.
import { fail, type MappedAiError } from './types.js';
import { truncate } from './values.js';
import { haystackOf, type ProviderSignals } from './signals.js';
import { mapOpenRouterErrorType } from './openrouter.js';
import {
  AUTH_RE,
  BILLING_RE,
  FILTER_RE,
  LENGTH_RE,
  MODEL_MISSING_RE,
  NETWORK_RE,
  OVERLOAD_RE,
  RATE_RE,
} from './patterns.js';

export function mapApiCallError(
  statusCode: number | undefined,
  signals: ProviderSignals,
  sdkMessage: string | null,
  retryableHint: boolean,
): MappedAiError {
  // OpenRouter typed vocabulary wins when present - it is stable across skins.
  if (signals.errorType) {
    const typed = mapOpenRouterErrorType(signals.errorType);
    if (typed) return typed;
  }

  const hay = haystackOf(signals, sdkMessage);
  const detail =
    signals.message && sdkMessage !== signals.message
      ? ` Provider detail: ${truncate(signals.message)}`
      : '';

  if (statusCode === 401) {
    return fail(
      'UNAUTHORIZED',
      'The provider rejected the API credentials. Check the API key configured for this provider.',
      401,
    );
  }
  if (AUTH_RE.test(hay) && (statusCode === undefined || statusCode === 401 || statusCode === 403)) {
    return fail(
      'UNAUTHORIZED',
      'The provider rejected the API credentials. Check the API key configured for this provider.',
      401,
    );
  }
  if (statusCode === 402 || BILLING_RE.test(hay)) {
    return fail(
      'PAYMENT_REQUIRED',
      'The provider account has insufficient credits or hit a spend limit. Add credits or raise the limit and retry.',
      402,
    );
  }
  if (statusCode === 404 || MODEL_MISSING_RE.test(hay)) {
    return fail(
      'MODEL_NOT_FOUND',
      'The requested model was not found on the provider. Check the model ID.',
      404,
    );
  }
  if (statusCode === 429 || RATE_RE.test(hay)) {
    return fail(
      'RATE_LIMITED',
      'The provider rate limit was hit. Wait a moment and retry.',
      429,
      true,
    );
  }
  if (LENGTH_RE.test(hay)) {
    return fail(
      'CONTEXT_LENGTH_EXCEEDED',
      'The conversation exceeds the model context window. Shorten the input, clear old messages, or switch to a model with a larger context window.',
      statusCode === 403 ? 403 : 400,
    );
  }
  if (FILTER_RE.test(hay)) {
    return fail(
      'CONTENT_FILTERED',
      'The input or output was flagged by a content filter. Rephrase and retry.',
      400,
    );
  }
  if (
    statusCode === 408 ||
    statusCode === 504 ||
    statusCode === 503 ||
    statusCode === 502 ||
    (statusCode !== undefined && statusCode >= 500) ||
    OVERLOAD_RE.test(hay) ||
    NETWORK_RE.test(hay)
  ) {
    const overloaded = statusCode === 503 || OVERLOAD_RE.test(hay);
    return fail(
      'PROVIDER_UNAVAILABLE',
      overloaded
        ? 'The provider is temporarily overloaded. Wait a moment and retry.'
        : 'The provider request failed. Retry, or try a different model if it persists.',
      statusCode ?? 502,
      true,
    );
  }
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    const detailMessage = signals.message
      ? ` The provider reported: ${truncate(signals.message)}`
      : '';
    return fail(
      'VALIDATION_FAILED',
      `The provider rejected the request (HTTP ${statusCode}). Check the model settings and retry.${detailMessage}`,
      statusCode,
    );
  }

  // No status (network-level failure) or unrecognized shape.
  if (NETWORK_RE.test(hay)) {
    return fail(
      'PROVIDER_UNAVAILABLE',
      'Cannot reach the provider. Check the network connection and base URL, then retry.',
      502,
      true,
    );
  }
  return fail('INTERNAL_ERROR', `The provider request failed.${detail}`, 500, retryableHint);
}
