import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PassThrough } from 'node:stream';
import { watchMessageSubrun } from '../../apps/actions/watch.message-subrun.js';
import { killMessageSubrun } from '../../apps/actions/kill.message-subrun.js';
import { NotFoundError } from '../../apps/shared/errors.js';
import type { Container } from '../../apps/bootstrap.js';
import { RunHotStorage, RunsRepository, RunsService, toSubRunKey } from '../../src/runs/index.js';

function makeCtx(
  runService: RunsService,
  shellService?: { killRunsForRun: (runId: string) => { killedCount: number } },
): Container {
  return {
    chatService: { findOne: async () => ({ id: 'chat-1' }) },
    runService,
    shellService: shellService ?? { killRunsForRun: () => ({ killedCount: 0 }) },
    logger: { info() {}, error() {}, warn() {}, debug() {} },
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
    stream.on('close', () => setImmediate(finish));
  });
}

async function makeRunAndSub(svc: RunsService): Promise<{ runId: string; subKey: string }> {
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  const subKey = svc.ensureSub({
    parentRunId: run.runId,
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
    toolCallId: 'call_1',
    agentName: 'explorer',
    title: 'Find auth code',
  });
  return { runId: run.runId, subKey };
}

test('watchMessageSubrun streams live child chunks then a run-close(done)', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const { runId, subKey } = await makeRunAndSub(svc);

  const { stream } = await watchMessageSubrun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId,
    toolCallId: 'call_1',
  });
  const pending = collect(stream);

  svc.publishSubChunk(subKey, 'data: {"type":"text-delta","delta":"hi"}\n\n');
  svc.publishSubDone(subKey);

  const { text, errors } = await pending;
  assert.equal(errors.length, 0);
  assert.match(text, /"delta":"hi"/);
  assert.match(text, /"type":"run-close".*"status":"done"/);
  assert.match(text, /"runId":"sub:/);
});

test('watchMessageSubrun replays buffered frames then terminal status for a finished child', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const { runId, subKey } = await makeRunAndSub(svc);
  svc.publishSubChunk(subKey, 'data: {"type":"text-delta","delta":"abc"}\n\n');
  svc.publishSubDone(subKey);

  const { stream } = await watchMessageSubrun(makeCtx(svc), {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId,
    toolCallId: 'call_1',
  });
  const { text, errors } = await collect(stream);
  assert.equal(errors.length, 0);
  assert.match(text, /"delta":"abc"/);
  assert.match(text, /"type":"run-close".*"status":"done"/);
});

test('watchMessageSubrun rejects an unknown child run', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const run = await svc.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  await assert.rejects(
    watchMessageSubrun(makeCtx(svc), {
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      runId: run.runId,
      toolCallId: 'missing',
    }),
    (err: unknown) => err instanceof NotFoundError,
  );
});

test('killMessageSubrun aborts the child and sweeps its scoped shell runs', async () => {
  const svc = new RunsService(new RunsRepository(new RunHotStorage()));
  const { runId, subKey } = await makeRunAndSub(svc);
  const shellCalls: string[] = [];
  const ctx = makeCtx(svc, {
    killRunsForRun: (id: string) => {
      shellCalls.push(id);
      return { killedCount: 1 };
    },
  });

  const result = await killMessageSubrun(ctx, {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId,
    toolCallId: 'call_1',
  });

  assert.equal(result.killed, true);
  assert.equal(result.subKey, toSubRunKey(runId, 'call_1'));
  assert.equal(shellCalls[0], subKey);
});
