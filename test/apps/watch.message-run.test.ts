import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PassThrough } from 'node:stream';
import { watchMessageRun } from '../../apps/actions/watch.message-run.js';
import type { Container } from '../../apps/bootstrap.js';
import { RunHotStorage, RunsRepository, RunsService } from '../../src/runs/index.js';

function makeCtx(runService: RunsService): Container {
  return {
    chatService: { findOne: async () => ({ id: 'chat-1' }) },
    runService,
  } as unknown as Container;
}

function collect(stream: PassThrough): Promise<{ text: string; errors: unknown[] }> {
  return new Promise((resolve) => {
    let text = '';
    const errors: unknown[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ text, errors });
    };
    stream.on('data', (chunk: Buffer | string) => {
      text += String(chunk);
    });
    stream.on('error', (err: unknown) => {
      errors.push(err);
    });
    stream.on('end', finish);
    stream.on('close', () => {
      // 'end' fires first on a clean end; this is only a fallback.
      setImmediate(finish);
    });
  });
}

test('watchMessageRun: late chunk after done neither throws nor corrupts the stream', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });

  const { stream } = await watchMessageRun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  const pending = collect(stream);

  svc.publishChunk(run.runId, 'data: {"type":"text-delta","delta":"hi"}\n\n');
  await svc.finish(run.runId, 'done');
  // Late publish racing the terminal event - must be a silent no-op.
  assert.equal(
    svc.publishChunk(run.runId, 'data: {"type":"text-delta","delta":"late"}\n\n'),
    false,
  );

  const { text, errors } = await pending;
  assert.equal(errors.length, 0);
  assert.match(text, /"delta":"hi"/);
  assert.doesNotMatch(text, /"delta":"late"/);
  assert.match(text, /"type":"run-close".*"status":"done"/);
});

test('watchMessageRun: already-finished run replays buffer then terminal status', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  svc.publishChunk(run.runId, 'data: {"type":"text-delta","delta":"abc"}\n\n');
  await svc.finish(run.runId, 'done');

  const { stream } = await watchMessageRun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  const { text, errors } = await collect(stream);
  assert.equal(errors.length, 0);
  assert.match(text, /"delta":"abc"/);
  assert.match(text, /"status":"done"/);
});

test('watchMessageRun: live failed run-close carries code + message', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });

  const { stream } = await watchMessageRun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  const pending = collect(stream);

  await svc.finish(run.runId, 'failed', { code: 'RATE_LIMITED', message: 'Slow down' });

  const { text, errors } = await pending;
  assert.equal(errors.length, 0);
  assert.match(text, /"type":"run-close".*"status":"failed"/);
  assert.match(text, /"code":"RATE_LIMITED"/);
  assert.match(text, /"message":"Slow down"/);
});

test('watchMessageRun: live cancelled run-close keeps cancelled status', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });

  const { stream } = await watchMessageRun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  const pending = collect(stream);

  await svc.finish(run.runId, 'cancelled', { code: 'RUN_ABORTED', message: 'Run cancelled' });

  const { text, errors } = await pending;
  assert.equal(errors.length, 0);
  assert.match(text, /"type":"run-close".*"status":"cancelled"/);
  assert.match(text, /"code":"RUN_ABORTED"/);
});

test('watchMessageRun: late joiner on failed run gets code + message from record', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  await svc.finish(run.runId, 'failed', { code: 'UNAUTHORIZED', message: 'Bad key' });

  const { stream } = await watchMessageRun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  const { text, errors } = await collect(stream);
  assert.equal(errors.length, 0);
  assert.match(text, /"type":"run-close".*"status":"failed"/);
  assert.match(text, /"code":"UNAUTHORIZED"/);
  assert.match(text, /"message":"Bad key"/);
});
