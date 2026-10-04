import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayHistory } from '../../apps/shared/chat-feed/replay.js';
import type { MessagePartRow, RunStepRow } from '../../src/messages/index.js';

function row(over: Partial<MessagePartRow> & { id: string; type: string }): MessagePartRow {
  return {
    messageId: 'm1',
    position: 0,
    text: null,
    state: null,
    toolCallId: null,
    inputJson: null,
    outputJson: null,
    errorText: null,
    providerExecuted: null,
    sourceId: null,
    url: null,
    title: null,
    mediaType: null,
    filename: null,
    dataJson: null,
    providerMetadataJson: null,
    isSystem: false,
    ...over,
  };
}

function step(over: Partial<RunStepRow> & { stepIndex: number }): RunStepRow {
  return {
    id: `s${over.stepIndex}`,
    messageId: 'm1',
    chatId: 'c1',
    runId: 'run_1',
    finishReason: 'stop',
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    modelId: null,
    providerMetadataJson: null,
    toolCallsJson: null,
    startedAtMs: null,
    finishedAtMs: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

test('replayHistory: user text becomes a completed triple without runId', () => {
  const events = replayHistory(
    [{ id: 'u1', role: 'user', parts: [row({ id: 'p1', type: 'text', text: 'halo' })], steps: [] }],
    { chatId: 'c1', at: 1 },
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ['text-open', 'text-delta', 'text-close'],
  );
  const delta = events[1];
  assert.equal(delta.type, 'text-delta');
  if (delta.type === 'text-delta') {
    assert.equal(delta.delta, 'halo');
    assert.equal(delta.runId, undefined);
    assert.equal(delta.messageId, 'u1');
  }
});

test('replayHistory: assistant tool row replays work triple + notice + stage-close', () => {
  const events = replayHistory(
    [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          row({ id: 'p1', type: 'text', text: 'done', position: 0 }),
          row({ id: 'p2', type: 'step-start', position: 1 }),
          row({
            id: 'p3',
            type: 'tool-read_file',
            position: 2,
            toolCallId: 'call-1',
            state: 'output-available',
            inputJson: JSON.stringify({ path: 'x.ts' }),
            outputJson: JSON.stringify('shown'),
            dataJson: JSON.stringify({ toolCallId: 'call-1', path: 'x.ts', content: 'RICH' }),
          }),
        ],
        steps: [step({ stepIndex: 0 })],
      },
    ],
    { chatId: 'c1', at: 7 },
  );
  assert.deepEqual(
    events.map((e) => e.type),
    [
      'text-open',
      'text-delta',
      'text-close',
      'stage-open',
      'work-queued',
      'work-active',
      'work-ok',
      'notice',
      'stage-close',
    ],
  );
  const notice = events.find((e) => e.type === 'notice');
  assert.ok(notice && notice.type === 'notice');
  assert.equal(notice.runId, 'run_1');
  assert.deepEqual(notice.body, { toolCallId: 'call-1', path: 'x.ts', content: 'RICH' });
  const close = events.find((e) => e.type === 'stage-close');
  assert.ok(close && close.type === 'stage-close');
  assert.equal(close.landed, 'stop');
  assert.equal(close.totalTokens, 30);
  assert.equal(close.runId, 'run_1');
});

test('replayHistory: system parts, legacy data rows, and empty text are skipped', () => {
  const events = replayHistory(
    [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          row({ id: 'p0', type: 'text', text: 'mode: edit', isSystem: true }),
          row({ id: 'p1', type: 'data-read_file', dataJson: '{}' }),
          row({ id: 'p2', type: 'text', text: '' }),
          row({ id: 'p3', type: 'reasoning', text: 'hmm' }),
        ],
        steps: [],
      },
    ],
    { chatId: 'c1', at: 1 },
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ['think-open', 'think-delta', 'think-close'],
  );
});

test('replayHistory: tool error replays work-bad', () => {
  const events = replayHistory(
    [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          row({
            id: 'p1',
            type: 'tool-run_shell',
            toolCallId: 'call-9',
            state: 'output-error',
            inputJson: JSON.stringify({ command: 'rm -rf' }),
            errorText: 'PERMISSION_DENIED: nope',
          }),
        ],
        steps: [],
      },
    ],
    { chatId: 'c1', at: 1 },
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ['work-queued', 'work-active', 'work-bad'],
  );
  const bad = events[2];
  assert.ok(bad.type === 'work-bad');
  if (bad.type === 'work-bad') {
    assert.equal(bad.errorText, 'PERMISSION_DENIED: nope');
    assert.equal(bad.implement, 'run_shell');
  }
});
