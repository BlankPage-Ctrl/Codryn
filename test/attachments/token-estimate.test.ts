import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateInputTokens,
  IMAGE_ESTIMATE_TOKENS,
} from '../../src/messages/engines/token-estimate.js';

test('file parts cost a fixed image estimate, payload excluded', () => {
  const bigPayload = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`;
  const tokens = estimateInputTokens([
    {
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'file', mediaType: 'image/png', data: bigPayload },
      ],
    },
  ]);
  // ~3 text tokens + exactly one image estimate - never megabytes/4.
  assert.ok(tokens < IMAGE_ESTIMATE_TOKENS + 100, `got ${tokens}`);
  assert.ok(tokens >= IMAGE_ESTIMATE_TOKENS, `got ${tokens}`);
});

test('legacy image parts get the same fixed estimate', () => {
  const tokens = estimateInputTokens([
    { content: [{ type: 'image', image: 'https://example.com/a.png' }] },
  ]);
  assert.equal(tokens, IMAGE_ESTIMATE_TOKENS);
});

test('multiple images accumulate per image', () => {
  const tokens = estimateInputTokens([
    {
      content: [
        { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAA' },
        { type: 'file', mediaType: 'image/jpeg', data: 'data:image/jpeg;base64,BBB' },
      ],
    },
  ]);
  assert.equal(tokens, IMAGE_ESTIMATE_TOKENS * 2);
});

test('plain text estimation is unchanged', () => {
  assert.equal(estimateInputTokens([{ content: 'abcd' }]), 1);
  assert.equal(
    estimateInputTokens([{ content: [{ type: 'text', text: 'abcd' }] }]),
    1,
  );
});

test('data-URLs hidden in other parts do not blow up the gate', () => {
  const tokens = estimateInputTokens([
    { content: [{ type: 'other', blob: `data:image/png;base64,${'B'.repeat(100000)}` }] },
  ]);
  assert.ok(tokens < 100, `got ${tokens}`);
});
