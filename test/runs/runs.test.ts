import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunHotStorage, RunsRepository, RunsService, framesAfter } from '../../src/runs/index.js';

function makeService(): RunsService {
  return new RunsService(new RunsRepository(new RunHotStorage()));
}

test('RunsService: create → get → listByChat', async () => {
  const svc = makeService();
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  assert.match(run.runId, /^run_/);
  assert.equal(run.status, 'running');

  const fetched = await svc.get(run.runId);
  assert.equal(fetched?.runId, run.runId);

  const listed = await svc.listByChat('chat-1');
  assert.equal(listed.length, 1);
  assert.equal((await svc.listByChat('chat-other')).length, 0);
});

test('RunsService: parallel runs per chat allowed', async () => {
  const svc = makeService();
  const a = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-a',
  });
  const b = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-b',
  });
  assert.notEqual(a.runId, b.runId);
  assert.equal((await svc.listByChat('chat-1')).length, 2);
});

test('RunsService: publish → frames → resume afterSeq', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  svc.publishChunk(run.runId, 'data: {"a":1}\n\n');
  svc.publishChunk(run.runId, 'data: {"a":2}\n\n');

  const all = svc.frames(run.runId);
  assert.equal(all.length, 2);
  assert.equal(all[0]?.seq, 1);
  assert.equal(all[1]?.seq, 2);

  const resumed = framesAfter(all, 1);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.seq, 2);
});

test('RunsService: subscribe receives live chunks; close unsubscribes', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  const received: string[] = [];
  const unsub = svc.subscribe(run.runId, {
    onChunk: (line) => received.push(line),
    onDone: () => received.push('DONE'),
    onError: (err) => received.push(`ERR:${err.code}:${err.message}`),
  });
  svc.publishChunk(run.runId, 'data: {"x":1}\n\n');
  assert.equal(received.length, 1);
  unsub();
  svc.publishChunk(run.runId, 'data: {"x":2}\n\n');
  assert.equal(received.length, 1);
});

test('RunsService: publish after terminal is dropped, never emitted', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  const received: string[] = [];
  let done = 0;
  svc.subscribe(run.runId, {
    onChunk: (line) => received.push(line),
    onDone: () => {
      done += 1;
    },
    onError: () => {},
  });
  assert.equal(svc.publishChunk(run.runId, 'data: {"x":1}\n\n'), true);
  await svc.finish(run.runId, 'done');
  assert.equal(done, 1);
  // Late publish (e.g. drain-loop tail racing publishDone): dropped, no emit, no seq/buffer growth.
  assert.equal(svc.publishChunk(run.runId, 'data: {"x":2}\n\n'), false);
  assert.equal(received.length, 1);
  assert.equal(svc.frames(run.runId).length, 1);
  // Terminal publish is idempotent - second finish/done is a no-op.
  await svc.finish(run.runId, 'done');
  assert.equal(done, 1);
});

test('RunsService: publish after error terminal is dropped', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  const received: unknown[] = [];
  svc.subscribe(run.runId, {
    onChunk: (line) => received.push(line),
    onDone: () => {},
    onError: (err) => received.push(err),
  });
  await svc.finish(run.runId, 'failed', { code: 'X', message: 'boom' });
  assert.deepEqual(received, [{ status: 'failed', code: 'X', message: 'boom' }]);
  assert.equal(svc.publishChunk(run.runId, 'data: {"x":9}\n\n'), false);
  assert.equal(received.length, 1);
});

test('RunsService: finish failed without error falls back to INTERNAL_ERROR', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  const received: unknown[] = [];
  svc.subscribe(run.runId, {
    onChunk: () => {},
    onDone: () => {},
    onError: (err) => received.push(err),
  });
  await svc.finish(run.runId, 'failed');
  assert.deepEqual(received, [{ status: 'failed', code: 'INTERNAL_ERROR', message: 'failed' }]);
});

test('RunsService: finish cancelled carries status + RUN_ABORTED fallback', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  const received: unknown[] = [];
  svc.subscribe(run.runId, {
    onChunk: () => {},
    onDone: () => {},
    onError: (err) => received.push(err),
  });
  await svc.finish(run.runId, 'cancelled');
  assert.deepEqual(received, [{ status: 'cancelled', code: 'RUN_ABORTED', message: 'cancelled' }]);
});

test('RunsService: finish done publishes terminal; cancel aborts signal', async () => {
  const svc = makeService();
  const run = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm' });
  let done = 0;
  svc.subscribe(run.runId, {
    onChunk: () => {},
    onDone: () => {
      done += 1;
    },
    onError: () => {},
  });
  const signal = svc.abortSignal(run.runId);
  assert.equal(signal?.aborted, false);
  const finished = await svc.finish(run.runId, 'done');
  assert.equal(finished?.status, 'done');
  assert.equal(done, 1);

  const run2 = await svc.create({ chatId: 'c', workspaceId: 'w', assistantMessageId: 'm2' });
  assert.equal(svc.requestCancel(run2.runId), true);
  assert.equal(svc.abortSignal(run2.runId)?.aborted, true);
  const cancelled = await svc.finish(run2.runId, 'cancelled', {
    code: 'RUN_ABORTED',
    message: 'x',
  });
  assert.equal(cancelled?.status, 'cancelled');
});
