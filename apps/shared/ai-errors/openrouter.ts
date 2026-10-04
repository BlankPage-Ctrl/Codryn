// OpenRouter typed error_type vocabulary (stable across skins).
// See https://openrouter.ai/docs/api/reference/errors-and-debugging
import { fail, type MappedAiError } from './types.js';

export function mapOpenRouterErrorType(errorType: string): MappedAiError | null {
  switch (errorType.toLowerCase()) {
    case 'context_length_exceeded':
      return fail(
        'CONTEXT_LENGTH_EXCEEDED',
        'The conversation exceeds the model context window. Shorten the input, clear old messages, or switch to a model with a larger context window.',
        400,
      );
    case 'max_tokens_exceeded':
      return fail(
        'CONTEXT_LENGTH_EXCEEDED',
        'Generation stopped at the output token limit. Raise max output tokens for this model or shorten the input.',
        400,
      );
    case 'token_limit_exceeded':
      return fail(
        'CONTEXT_LENGTH_EXCEEDED',
        'A token budget for this request was exceeded. Shorten the input or raise the model token limits.',
        400,
      );
    case 'string_too_long':
      return fail(
        'CONTEXT_LENGTH_EXCEEDED',
        'A single message exceeds the provider per-field character limit. Shorten that message and retry.',
        400,
      );
    case 'authentication':
      return fail(
        'UNAUTHORIZED',
        'The provider rejected the API credentials. Check the API key configured for this provider.',
        401,
      );
    case 'permission_denied':
      return fail(
        'FORBIDDEN',
        'The request was denied by the provider (permissions or guardrail block). Check the provider settings and retry.',
        403,
      );
    case 'payment_required':
      return fail(
        'PAYMENT_REQUIRED',
        'The provider account has insufficient credits. Add credits and retry.',
        402,
      );
    case 'rate_limit_exceeded':
      return fail(
        'RATE_LIMITED',
        'The provider rate limit was hit. Wait a moment and retry.',
        429,
        true,
      );
    case 'provider_overloaded':
      return fail(
        'PROVIDER_UNAVAILABLE',
        'The provider is temporarily overloaded. Wait a moment and retry.',
        503,
        true,
      );
    case 'provider_unavailable':
      return fail(
        'PROVIDER_UNAVAILABLE',
        'The provider returned an invalid or empty response. Retry, or switch models if it persists.',
        502,
        true,
      );
    case 'invalid_request':
    case 'invalid_prompt':
      return null; // Fall through to generic validation handling.
    case 'not_found':
      return fail(
        'MODEL_NOT_FOUND',
        'The requested model was not found on the provider. Check the model ID.',
        404,
      );
    case 'payload_too_large':
      return fail(
        'VALIDATION_FAILED',
        'The request body exceeds the provider size limit. Shorten the input and retry.',
        413,
      );
    case 'unprocessable':
      return fail('VALIDATION_FAILED', 'The provider could not process the request.', 422);
    case 'content_policy_violation':
      return fail(
        'CONTENT_FILTERED',
        'The input or output was flagged by a content filter. Rephrase and retry.',
        400,
      );
    case 'refusal':
      return fail(
        'CONTENT_FILTERED',
        'The provider refused to respond to this request. Rephrase and retry.',
        400,
      );
    case 'timeout':
      return fail(
        'PROVIDER_UNAVAILABLE',
        'The provider timed out. Retry, or try a different model.',
        504,
        true,
      );
    case 'server':
    case 'unmapped':
      return fail(
        'PROVIDER_UNAVAILABLE',
        'The provider hit an internal error. Retry, or try a different model.',
        500,
        true,
      );
    default:
      return null;
  }
}
