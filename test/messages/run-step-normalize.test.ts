import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeStepFinish } from '../../src/messages/engines/run-step-normalize.js';

test('normalizeStepFinish: full AI SDK v7 usage shape', async () => {
  const out = normalizeStepFinish({
    finishReason: 'tool-calls',
    usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 },
    toolCalls: [{ toolCallId: 'tc1', toolName: 'run_shell', input: { cmd: 'ls' } }],
    response: { modelId: 'openai/gpt-4o-mini' },
    providerMetadata: { openai: { reason: 'x' } },
  });
  assert.equal(out.finishReason, 'tool-calls');
  assert.equal(out.inputTokens, 120);
  assert.equal(out.outputTokens, 45);
  assert.equal(out.totalTokens, 165);
  assert.equal(out.modelId, 'openai/gpt-4o-mini');
  assert.deepEqual(JSON.parse(out.toolCallsJson!), [{ toolCallId: 'tc1', toolName: 'run_shell' }]);
  assert.deepEqual(JSON.parse(out.providerMetadataJson!), { openai: { reason: 'x' } });
});

test('normalizeStepFinish: legacy prompt/completion tokens + derived total', async () => {
  const out = normalizeStepFinish({
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20 },
  });
  assert.equal(out.inputTokens, 10);
  assert.equal(out.outputTokens, 20);
  assert.equal(out.totalTokens, 30);
});

test('normalizeStepFinish: missing/garbage usage yields nulls, never throws', async () => {
  for (const usage of [undefined, null, 'nope', 42, [], { inputTokens: -5, outputTokens: NaN }]) {
    const out = normalizeStepFinish({ finishReason: 'stop', usage });
    assert.equal(out.inputTokens, null);
    assert.equal(out.outputTokens, null);
    assert.equal(out.totalTokens, null);
  }
});

test('normalizeStepFinish: finishReason mapping', async () => {
  assert.equal(normalizeStepFinish({ finishReason: 'stop' }).finishReason, 'stop');
  assert.equal(normalizeStepFinish({ finishReason: 'weird-new-reason' }).finishReason, 'other');
  assert.equal(normalizeStepFinish({}).finishReason, null);
  assert.equal(normalizeStepFinish({ finishReason: 42 }).finishReason, null);
});

test('normalizeStepFinish: toolCalls capped, garbage skipped, empty is null', async () => {
  assert.equal(normalizeStepFinish({ toolCalls: [] }).toolCallsJson, null);
  assert.equal(normalizeStepFinish({ toolCalls: [null, 42, {}] }).toolCallsJson, null);
  const many = Array.from({ length: 60 }, (_, i) => ({ toolCallId: `tc${i}`, toolName: 't' }));
  const out = normalizeStepFinish({ toolCalls: many });
  assert.equal(JSON.parse(out.toolCallsJson!).length, 50);
});

test('normalizeStepFinish: modelId + providerMetadata edge cases', async () => {
  assert.equal(normalizeStepFinish({}).modelId, null);
  assert.equal(normalizeStepFinish({ response: { modelId: 42 } }).modelId, null);
  assert.equal(normalizeStepFinish({ providerMetadata: undefined }).providerMetadataJson, null);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(normalizeStepFinish({ providerMetadata: circular }).providerMetadataJson, null);
});
