import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import { MessagesRepository } from '../../src/messages/repository/messages.js';
import { MessagesService } from '../../src/messages/services/messages.js';
import { ColdMessagesStorage } from '../../src/messages/storages/cold/messages.js';
import { ColdMessagePartsStorage } from '../../src/messages/storages/cold/message-parts.js';
import { ColdRunStepsStorage } from '../../src/messages/storages/cold/run-steps.js';
import { RunHotStorage, RunsRepository, RunsService } from '../../src/runs/index.js';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'msg-cancel-partial-'));
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const manager = new DatabaseManager(schema, dbPath);
  const db = await manager.init();
  const repo = new MessagesRepository(
    new ColdMessagesStorage(db as never),
    new ColdMessagePartsStorage(db as never),
    new ColdRunStepsStorage(db as never),
  );
  const messagesService = new MessagesService(repo);
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));
  return { messagesService, runService, cleanup: async () => {
    await manager.close();
    await rm(dir, { recursive: true, force: true });
  } };
}

test('cancel preserves partial parts + run steps (regression: Stop wiped DB via discard)', async () => {
  const { messagesService, runService, cleanup } = await setup();
  try {
    const chatId = 'chat-1';
    const assistantMessageId = 'a-cancel-1';
    const run = await runService.create({ chatId, workspaceId: 'ws-1', assistantMessageId });

    const persister = messagesService.createStreamingPersister({
      chatId,
      userMessage: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hai' }] },
      assistantMessageId,
    });
    await persister.prepare();

    // 2 streaming chunks (text-start + deltas) - flushed incrementally to DB.
    await persister.onChunk({ type: 'text-start', id: 't1' } as never);
    await persister.onChunk({ type: 'text-delta', id: 't1', text: 'halo ' } as never);
    await persister.onChunk({ type: 'text-delta', id: 't1', text: 'dunia' } as never);

    // 1 finished step - written directly to DB via recordRunStep.
    await messagesService.recordRunStep({
      messageId: assistantMessageId,
      chatId,
      runId: run.runId,
      stepIndex: 0,
      finishReason: 'tool-calls',
      startedAtMs: Date.now() - 10,
      finishedAtMs: Date.now(),
    });

    // Simulate user hitting Stop: requestCancel + finish('cancelled'),
    // then background onEnd(isAborted=true) - must finalize partial,
    // never discard() (which deletes the message row + cascade-wipes parts/steps).
    runService.requestCancel(run.runId);
    await runService.finish(run.runId, 'cancelled', {
      code: 'RUN_ABORTED',
      message: 'Run cancelled by user',
    });

    const partialMessages = [
      {
        id: assistantMessageId,
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'halo dunia' }],
      },
    ];
    await persister.finalize(partialMessages as never);
    const finished = await runService.finish(run.runId, 'cancelled', {
      code: 'RUN_ABORTED',
      message: 'Run aborted',
    });

    // finish() is idempotent - first cancel wins, background finish is a no-op.
    assert.equal(finished?.status, 'cancelled');

    const history = await messagesService.load(chatId);
    const assistant = history.find((m) => m.id === assistantMessageId);
    assert.ok(assistant, 'assistant message must survive cancel');
    const text = (assistant.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('');
    assert.match(text, /halo/);

    const steps = await messagesService.listRunStepsByMessage(assistantMessageId);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.finishReason, 'tool-calls');
  } finally {
    await cleanup();
  }
});

test('abort racing onEnd (catch path) flushes via interrupt instead of wiping', async () => {
  const { messagesService, cleanup } = await setup();
  try {
    const persister = messagesService.createStreamingPersister({
      chatId: 'chat-1',
      userMessage: { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'hai' }] },
      assistantMessageId: 'a-cancel-2',
    });
    await persister.prepare();
    await persister.onChunk({ type: 'text-start', id: 't9' } as never);
    await persister.onChunk({ type: 'text-delta', id: 't9', text: 'parsial' } as never);

    // Catch-path on abort: interrupt() flushes the buffer, keeps the row.
    await persister.interrupt();

    const history = await messagesService.load('chat-1');
    const assistant = history.find((m) => m.id === 'a-cancel-2');
    assert.ok(assistant, 'assistant message must survive abort-race interrupt');
  } finally {
    await cleanup();
  }
});
