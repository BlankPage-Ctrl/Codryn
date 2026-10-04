import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APICallError, LoadAPIKeyError, NoSuchModelError, RetryError } from 'ai';
import { isAbortError, mapAiError } from '../../apps/shared/ai-errors/index.js';

function apiError(params: {
  message: string;
  statusCode?: number;
  body?: unknown;
  data?: unknown;
}): APICallError {
  const responseBody = params.body !== undefined ? JSON.stringify(params.body) : undefined;
  return new APICallError({
    message: params.message,
    url: 'https://provider.example/v1/chat/completions',
    requestBodyValues: {},
    statusCode: params.statusCode,
    responseBody,
    data: params.data,
  });
}

const openAiBody = (error: unknown) => ({ error });

test('OpenAI shape: context length maps to CONTEXT_LENGTH_EXCEEDED', () => {
  const err = apiError({
    message: "This model's maximum context length is 128000 tokens.",
    statusCode: 400,
    body: openAiBody({
      message: "This model's maximum context length is 128000 tokens.",
      type: 'invalid_request_error',
      code: 'context_length_exceeded',
      param: 'messages',
    }),
  });
  const mapped = mapAiError(err, { chatId: 'c1' });
  assert.equal(mapped.code, 'CONTEXT_LENGTH_EXCEEDED');
  assert.equal(mapped.status, 400);
  assert.equal(mapped.retryable, false);
  assert.match(mapped.message, /context window/);
});

test('OpenAI shape: 401 maps to UNAUTHORIZED', () => {
  const err = apiError({
    message: 'Incorrect API key provided.',
    statusCode: 401,
    body: openAiBody({ message: 'Incorrect API key provided.', type: 'invalid_request_error' }),
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'UNAUTHORIZED');
  assert.equal(mapped.status, 401);
});

test('OpenAI shape: billing code maps to PAYMENT_REQUIRED', () => {
  const err = apiError({
    message: 'You exceeded your current quota.',
    statusCode: 429,
    body: openAiBody({
      message: 'You exceeded your current quota.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    }),
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'PAYMENT_REQUIRED');
  assert.equal(mapped.status, 402);
});

test('OpenRouter shape: error_type wins over status', () => {
  const err = apiError({
    message: 'Rate limit exceeded',
    statusCode: 429,
    body: {
      error: {
        code: 429,
        message: 'Rate limit exceeded',
        metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
      },
    },
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'RATE_LIMITED');
  assert.equal(mapped.status, 429);
  assert.equal(mapped.retryable, true);
});

test('OpenRouter shape: masked 500 still maps via error_type', () => {
  const err = apiError({
    message: 'Internal server error',
    statusCode: 500,
    body: {
      error: {
        code: 500,
        message: 'Internal server error',
        metadata: { error_type: 'server' },
      },
    },
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(mapped.retryable, true);
});

test('OpenRouter shape: payment_required and refusal', () => {
  const pay = apiError({
    message: 'Insufficient credits',
    statusCode: 402,
    body: {
      error: {
        code: 402,
        message: 'Insufficient credits',
        metadata: { error_type: 'payment_required' },
      },
    },
  });
  assert.equal(mapAiError(pay).code, 'PAYMENT_REQUIRED');

  const refusal = apiError({
    message: 'refused to respond',
    statusCode: 403,
    body: {
      error: { code: 403, message: 'refused to respond', metadata: { error_type: 'refusal' } },
    },
  });
  assert.equal(mapAiError(refusal).code, 'CONTENT_FILTERED');
});

test('Compatible shape: numeric code tolerated', () => {
  const err = apiError({
    message: 'Bad Request',
    statusCode: 400,
    body: { error: { message: 'engine overloaded, try again later', code: 400 } },
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(mapped.retryable, true);
});

test('Unparseable body falls back to validation message', () => {
  const err = new APICallError({
    message: 'Bad Request',
    url: 'https://provider.example/x',
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '<html>nope</html>',
  });
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'VALIDATION_FAILED');
  assert.equal(mapped.status, 400);
});

test('Network failure maps to retryable PROVIDER_UNAVAILABLE', () => {
  const mapped = mapAiError(new TypeError('fetch failed'));
  assert.equal(mapped.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(mapped.retryable, true);
});

test('SDK typed errors map directly', () => {
  assert.equal(mapAiError(new LoadAPIKeyError({ message: 'missing' })).code, 'UNAUTHORIZED');
  assert.equal(
    mapAiError(new NoSuchModelError({ modelId: 'x', modelType: 'languageModel' })).code,
    'MODEL_NOT_FOUND',
  );
  const retry = new RetryError({
    message: 'failed',
    reason: 'maxRetriesExceeded',
    errors: [apiError({ message: 'boom', statusCode: 503, body: openAiBody({ message: 'boom' }) })],
  });
  const mapped = mapAiError(retry);
  assert.equal(mapped.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(mapped.retryable, true);
});

test('Unknown error: best effort surfaces nested message', () => {
  const mapped = mapAiError({ error: { message: 'something broke downstream' } });
  assert.equal(mapped.code, 'INTERNAL_ERROR');
  assert.match(mapped.message, /something broke downstream/);
});

test('No message at all: points at the application log with chatId', () => {
  const mapped = mapAiError({}, { chatId: 'chat-9' });
  assert.equal(mapped.code, 'INTERNAL_ERROR');
  assert.match(mapped.message, /application log/);
  assert.match(mapped.message, /chat-9/);
});

test('Abort errors are identified, never surfaced as failures', () => {
  const abort = new DOMException('aborted', 'AbortError');
  assert.equal(isAbortError(abort), true);
  assert.equal(mapAiError(abort).code, 'RUN_ABORTED');
  assert.equal(isAbortError(new Error('nope')), false);
});
