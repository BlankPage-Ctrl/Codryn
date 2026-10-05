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
import { ValidationError } from '../../src/messages/errors/validation.js';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'msg-run-steps-'));
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const manager = new DatabaseManager(schema, dbPath);
  const db = await manager.init();
  const repo = new MessagesRepository(
    new ColdMessagesStorage(db as never),
    new ColdMessagePartsStorage(db as never),
    new ColdRunStepsStorage(db as never),
  );
  const service = new MessagesService(repo);
  return {
    service,
    repo,
    cleanup: async () => {
      await manager.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const assistantMsg = (id: string) => ({
  id,
  role: 'assistant' as const,
  parts: [{ type: 'text' as const, text: 'hi' }],
});

const step = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'a1',
  chatId: 'chat-1',
  runId: 'run_1',
  stepIndex: 0,
  ...overrides,
});

test('recordRunStep → listByMessage ordered by stepIndex; listByRun', async () => {
  const { service, cleanup } = await setup();
  try {
    await service.append('chat-1', assistantMsg('a1'));
    await service.recordRunStep(step({ stepIndex: 1, finishReason: 'stop', totalTokens: 10 }));
    await service.recordRunStep(
      step({ stepIndex: 0, finishReason: 'tool-calls', inputTokens: 5, outputTokens: 7 }),
    );

    const byMessage = await service.listRunStepsByMessage('a1');
    assert.deepEqual(
      byMessage.map((r) => r.stepIndex),
      [0, 1],
    );
    assert.equal(byMessage[0]?.finishReason, 'tool-calls');
    assert.equal(byMessage[0]?.inputTokens, 5);

    const byRun = await service.listRunStepsByRun('run_1');
    assert.equal(byRun.length, 2);
    assert.equal((await service.listRunStepsByRun('run_other')).length, 0);
  } finally {
    await cleanup();
  }
});

test('recordRunStep is idempotent on (messageId, stepIndex)', async () => {
  const { service, cleanup } = await setup();
  try {
    await service.append('chat-1', assistantMsg('a1'));
    const first = await service.recordRunStep(step({ totalTokens: 10 }));
    const second = await service.recordRunStep(step({ totalTokens: 99 }));
    assert.equal(first.id, second.id);
    assert.equal((await service.listRunStepsByMessage('a1')).length, 1);
  } finally {
    await cleanup();
  }
});

test('recordRunStep rejects invalid input with ValidationError', async () => {
  const { service, cleanup } = await setup();
  try {
    await assert.rejects(service.recordRunStep(step({ messageId: '' })), ValidationError);
    await assert.rejects(service.recordRunStep(step({ stepIndex: -1 })), ValidationError);
    await assert.rejects(service.listRunStepsByMessage(''), ValidationError);
    await assert.rejects(service.listRunStepsByRun(''), ValidationError);
  } finally {
    await cleanup();
  }
});

test('deleteMessage removes run steps; deleteByChatId removes run steps', async () => {
  const { service, cleanup } = await setup();
  try {
    await service.append('chat-1', assistantMsg('a1'));
    await service.append('chat-1', assistantMsg('a2'));
    await service.recordRunStep(step({ messageId: 'a1' }));
    await service.recordRunStep(step({ messageId: 'a2', runId: 'run_2' }));

    await service.deleteMessage('chat-1', 'a1');
    assert.deepEqual(await service.listRunStepsByMessage('a1'), []);
    assert.equal((await service.listRunStepsByMessage('a2')).length, 1);

    await service.clear('chat-1');
    assert.deepEqual(await service.listRunStepsByMessage('a2'), []);
  } finally {
    await cleanup();
  }
});
