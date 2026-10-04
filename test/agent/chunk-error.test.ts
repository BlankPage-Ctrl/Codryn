import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { InvalidToolInputError } from 'ai';
import { formatToolChunkError } from '../../src/agent/adapters/chunk-error.js';

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

test('chunk error: non-validation errors stay redacted', () => {
  assert.equal(formatToolChunkError(new Error('connection reset by peer')), 'An error occurred.');
  assert.equal(formatToolChunkError('boom'), 'An error occurred.');
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
