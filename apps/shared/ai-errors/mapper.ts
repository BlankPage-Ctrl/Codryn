// Top-level entry: any AI SDK / provider / unknown error to user-facing result.
// Pure function: no logging here - callers log with the `sensitive` flag.
import { AISDKError, APICallError, LoadAPIKeyError, NoSuchModelError, RetryError } from 'ai';
import { fail, type MapAiErrorOptions, type MappedAiError } from './types.js';
import {
  asNonEmptyString,
  asRecord,
  errorName,
  huntMessage,
  isAbortError,
  parseJsonBody,
  truncate,
} from './values.js';
import { parseProviderSignals } from './signals.js';
import { mapSemanticHaystack } from './patterns.js';
import { mapApiCallError } from './api-call.js';

export function mapAiError(err: unknown, options: MapAiErrorOptions = {}): MappedAiError {
  if (isAbortError(err)) {
    return fail('RUN_ABORTED', 'The run was cancelled.', 499);
  }

  // RetryError wraps the last attempt - map its cause when available.
  if (RetryError.isInstance(err)) {
    const cause = asRecord(err)?.cause;
    if (cause && (APICallError.isInstance(cause) || cause instanceof Error)) {
      const mapped = mapAiError(cause, options);
      return { ...mapped, code: 'PROVIDER_UNAVAILABLE', retryable: true };
    }
    return fail(
      'PROVIDER_UNAVAILABLE',
      'The provider request failed after retries. Wait a moment and retry.',
      503,
      true,
    );
  }

  if (LoadAPIKeyError.isInstance(err)) {
    return fail(
      'UNAUTHORIZED',
      'The provider API key is missing. Configure an API key for this provider.',
      401,
    );
  }

  if (NoSuchModelError.isInstance(err)) {
    return fail(
      'MODEL_NOT_FOUND',
      'The requested model was not found on the provider. Check the model ID.',
      404,
    );
  }

  if (APICallError.isInstance(err)) {
    const typed = err as APICallError;
    const sdkMessage = asNonEmptyString(typed.message);
    const signals = parseProviderSignals(typed.data ?? parseJsonBody(typed.responseBody));
    return mapApiCallError(typed.statusCode, signals, sdkMessage, typed.isRetryable);
  }

  if (AISDKError.isInstance(err)) {
    const name = errorName(err) ?? 'AISDKError';
    const detail = huntMessage(err);
    return fail(
      'INTERNAL_ERROR',
      detail
        ? `The AI request failed (${name}). ${truncate(detail)}`
        : `The AI request failed (${name}). Check the application log${options.chatId ? ` (chatId: ${options.chatId})` : ''}.`,
      500,
    );
  }

  // Unknown error: best effort - semantic match first, then raw message.
  const found = huntMessage(err);
  if (found) {
    const semantic = mapSemanticHaystack(found);
    if (semantic) return semantic;
    return fail('INTERNAL_ERROR', `The AI request failed. ${truncate(found)}`, 500);
  }
  // No message field at all: point at the application log with the chat ID.
  return fail(
    'INTERNAL_ERROR',
    `An unexpected error occurred with no details. Check the application log${options.chatId ? ` (chatId: ${options.chatId})` : ''}.`,
    500,
  );
}
