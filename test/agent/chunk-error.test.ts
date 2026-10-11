import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { InvalidToolInputError } from 'ai';
import { formatToolChunkError } from '../../src/agent/adapters/chunk-error.js';
import { mapAiError } from '../../apps/shared/ai-errors/index.js';

test('chunk error: zod-style issues name the fields', () => {
  const err = {
    name: 'AI_InvalidToolInputError',
    toolName: 'grep',
    message: 'Invalid input for tool grep: ...',
    cause: {
      issues: [
        { path: ['pattern'], message: 'Required' },
        { path: ['maxResults'], message: 'Expected number, received string' },
      ],
    },
  };
  const out = formatToolChunkError(err);
  assert.ok(out.includes('`grep`'), 'names the tool');
  assert.ok(out.includes('`pattern`'), 'names the missing field');
  assert.ok(out.includes('`maxResults`'), 'names the second field');
  assert.ok(!out.includes('An error occurred.'), 'not the generic redaction');
});

test('chunk error: real InvalidToolInputError with real ZodError cause', () => {
  const schema = z.object({ pattern: z.string().min(1) });
  const parsed = schema.safeParse({});
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const err = new InvalidToolInputError({
      toolName: 'grep',
      toolInput: '{}',
      cause: parsed.error,
    });
    const out = formatToolChunkError(err);
    assert.ok(out.includes('`grep`'), `expected tool named, got: ${out}`);
    assert.ok(out.includes('`pattern`'), `expected pattern named, got: ${out}`);
  }
});

test('chunk error: non-validation errors keep their signal for downstream mapping', () => {
  // Provider/network text must survive: the outer stream onError re-maps it
  // via mapAiError (oops/run-close -> user banner). Redacting it here used
  // to leak a generic INTERNAL_ERROR ("An error occurred.") to the user.
  assert.equal(formatToolChunkError(new Error('connection reset by peer')), 'connection reset by peer');
  assert.equal(formatToolChunkError('boom'), 'boom');
  assert.equal(formatToolChunkError(null), 'An error occurred.');
  assert.equal(formatToolChunkError({ code: 'SOME_SERVER_FAULT' }), 'An error occurred.');
});

test('chunk error: validation without issues falls back to message', () => {
  const out = formatToolChunkError({
    name: 'AI_InvalidToolInputError',
    toolName: 'read_file',
    message: 'Invalid input for tool read_file: something odd',
  });
  assert.ok(out.includes('`read_file`'));
  assert.ok(out.includes('something odd'));
});

test('chunk error: provider signal survives the user-banner chain', () => {
  // Chain: stream `error` chunk -> inner onError (formatToolChunkError) ->
  // UIMessage `error` chunk -> outer onError -> mapAiError -> oops/run-close.
  const innerText = formatToolChunkError(new Error('fetch failed: socket hang up'));
  const mapped = mapAiError(new Error(innerText), { chatId: 'chat_1' });
  assert.equal(mapped.code, 'PROVIDER_UNAVAILABLE');
  assert.ok(!mapped.message.includes('An error occurred.'));
});
