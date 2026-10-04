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
  const dir = await mkdtemp(join(tmpdir(), 'msg-delete-'));
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

const userMsg = (id: string) => ({
  id,
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: `hello ${id}` }],
});

test('deleteMessage removes one message and its parts via FK cascade, keeps the rest', async () => {
  const { repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', userMsg('u1'));
    await repo.append('chat-1', userMsg('u2'));

    assert.equal((await repo.findByChatId('chat-1')).length, 2);

    await repo.deleteMessage('chat-1', 'u1');

    const remaining = await repo.findByChatId('chat-1');
    assert.deepEqual(
      remaining.map((m) => m.id),
      ['u2'],
    );
    assert.deepEqual(await repo.findPartsByMessageId('u1'), []);
    assert.ok((await repo.findPartsByMessageId('u2')).length > 0);
  } finally {
    await cleanup();
  }
});

test('deleteMessage on a missing message is a no-op for the rest', async () => {
  const { repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', userMsg('u1'));
    await repo.deleteMessage('chat-1', 'nope');
    assert.deepEqual(
      (await repo.findByChatId('chat-1')).map((m) => m.id),
      ['u1'],
    );
  } finally {
    await cleanup();
  }
});
