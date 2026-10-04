import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAT_FEED_NAMES,
  ChatFeedBus,
  encodeFeedLine,
  mapFeedChunk,
} from '../../apps/shared/chat-feed/index.js';

const scope = { runId: 'run_1', chatId: 'chat_1', messageId: 'msg_1', stage: 0 };

test('mapFeedChunk: text lifecycle maps to text-open/delta/close', () => {
  const open = mapFeedChunk({ type: 'text-start', id: 's1' } as never, scope);
  assert.equal(open.length, 1);
  assert.equal(open[0].name, 'text-open');

  const delta = mapFeedChunk({ type: 'text-delta', id: 's1', text: 'hi' } as never, scope);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].name, 'text-delta');
  assert.equal((delta[0].payload as { delta: string }).delta, 'hi');

  const close = mapFeedChunk({ type: 'text-end', id: 's1' } as never, scope);
  assert.equal(close.length, 1);
  assert.equal(close[0].name, 'text-close');
});

test('mapFeedChunk: tool lifecycle maps to queued/active/ok/bad', () => {
  const queued = mapFeedChunk(
    { type: 'tool-input-start', id: 'c1', toolName: 'read_file' } as never,
    scope,
  );
  assert.equal(queued[0].name, 'work-queued');

  const active = mapFeedChunk(
    { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { path: 'x' } } as never,
    scope,
  );
  assert.equal(active[0].name, 'work-active');

  const ok = mapFeedChunk(
    {
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'read_file',
      input: {},
      output: 'ok',
    } as never,
    scope,
  );
  assert.equal(ok[0].name, 'work-ok');

  const bad = mapFeedChunk(
    {
      type: 'tool-error',
      toolCallId: 'c1',
      toolName: 'read_file',
      input: {},
      error: 'boom',
    } as never,
    scope,
  );
  assert.equal(bad[0].name, 'work-bad');
  assert.equal((bad[0].payload as { errorText: string }).errorText, 'boom');
});

test('mapFeedChunk: noisy chunks are dropped', () => {
  assert.equal(
    mapFeedChunk({ type: 'tool-input-delta', id: 'c1', delta: '{}' } as never, scope).length,
    0,
  );
  assert.equal(mapFeedChunk({ type: 'start' } as never, scope).length, 0);
});

test('mapFeedChunk: start-step opens the caller stage', () => {
  const drafts = mapFeedChunk({ type: 'start-step' } as never, { ...scope, stage: 3 });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].name, 'stage-open');
  assert.equal((drafts[0].payload as { stage: number }).stage, 3);
});

test('encodeFeedLine: emits a data line without seq', () => {
  const line = encodeFeedLine('text-delta', {
    runId: 'run_1',
    chatId: 'chat_1',
    messageId: 'msg_1',
    sliceId: 's1',
    delta: 'hi',
    at: 1,
  });
  assert.match(line, /^data: /);
  assert.match(line, /"type":"text-delta"/);
  assert.doesNotMatch(line, /"seq"/);
});

test('ChatFeedBus: on/emit/off round-trips per name', () => {
  const bus = new ChatFeedBus();
  const seen: string[] = [];
  const handler = (p: { delta: string }): void => {
    seen.push(p.delta);
  };
  bus.on('text-delta', handler);
  bus.emit('text-delta', {
    runId: 'run_1',
    chatId: 'chat_1',
    messageId: 'msg_1',
    sliceId: 's1',
    delta: 'a',
    at: 1,
  });
  bus.off('text-delta', handler);
  bus.emit('text-delta', {
    runId: 'run_1',
    chatId: 'chat_1',
    messageId: 'msg_1',
    sliceId: 's1',
    delta: 'b',
    at: 2,
  });
  assert.deepEqual(seen, ['a']);
  assert.ok(CHAT_FEED_NAMES.includes('run-close'));
});
