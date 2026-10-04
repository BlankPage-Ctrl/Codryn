import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import { MessagesRepository } from '../../src/messages/repository/messages.js';
import { ColdMessagesStorage } from '../../src/messages/storages/cold/messages.js';
import { ColdMessagePartsStorage } from '../../src/messages/storages/cold/message-parts.js';
import { ColdRunStepsStorage } from '../../src/messages/storages/cold/run-steps.js';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'msg-revert-'));
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const db = await new DatabaseManager(schema, dbPath).init();
  const repo = new MessagesRepository(
    new ColdMessagesStorage(db as never),
    new ColdMessagePartsStorage(db as never),
    new ColdRunStepsStorage(db as never),
  );
  return {
    repo,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const msg = (id: string, role: 'user' | 'assistant') => ({
  id,
  role,
  parts: [{ type: 'text' as const, text: `hello ${id}` }],
});

test('revertFromMessage deletes the target user message and its suffix, keeps the prefix', async () => {
  const { repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', msg('u1', 'user'));
    await repo.append('chat-1', msg('a1', 'assistant'));
    await repo.append('chat-1', msg('u2', 'user'));
    await repo.append('chat-1', msg('a2', 'assistant'));
    await repo.recordRunStep({
      messageId: 'a2',
      chatId: 'chat-1',
      runId: 'run-1',
      stepIndex: 0,
    });

    const result = await repo.revertFromMessage('chat-1', 'u2');

    assert.deepEqual(result.deletedMessageIds, ['u2', 'a2']);
    assert.deepEqual(
      (await repo.findByChatId('chat-1')).map((m) => m.id),
      ['u1', 'a1'],
    );
    assert.deepEqual(await repo.findPartsByMessageId('u2'), []);
    assert.deepEqual(await repo.findPartsByMessageId('a2'), []);
    assert.deepEqual(await repo.listRunStepsByMessage('a2'), []);
    assert.ok((await repo.findPartsByMessageId('u1')).length > 0);
  } finally {
    await cleanup();
  }
});

test('revertFromMessage on the first message clears the chat and resets position', async () => {
  const { repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', msg('u1', 'user'));
    await repo.append('chat-1', msg('a1', 'assistant'));

    const result = await repo.revertFromMessage('chat-1', 'u1');

    assert.deepEqual(result.deletedMessageIds, ['u1', 'a1']);
    assert.deepEqual(await repo.findByChatId('chat-1'), []);

    await repo.append('chat-1', msg('u3', 'user'));
    assert.deepEqual(
      (await repo.findByChatId('chat-1')).map((m) => m.id),
      ['u3'],
    );
  } finally {
    await cleanup();
  }
});

test('revertFromMessage rejects a missing target and a non-user target', async () => {
  const { repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', msg('u1', 'user'));
    await repo.append('chat-1', msg('a1', 'assistant'));

    await assert.rejects(() => repo.revertFromMessage('chat-1', 'nope'));
    await assert.rejects(() => repo.revertFromMessage('chat-1', 'a1'));
    assert.deepEqual(
      (await repo.findByChatId('chat-1')).map((m) => m.id),
      ['u1', 'a1'],
    );
  } finally {
    await cleanup();
  }
});
