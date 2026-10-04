import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import { MessagesRepository } from '../../src/messages/repository/messages.js';
import { ColdMessagesStorage } from '../../src/messages/storages/cold/messages.js';
import { ColdMessagePartsStorage } from '../../src/messages/storages/cold/message-parts.js';
import { ColdRunStepsStorage } from '../../src/messages/storages/cold/run-steps.js';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'db-manager-'));
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const manager = new DatabaseManager(schema, dbPath);
  const db = await manager.init();
  const parts = new ColdMessagePartsStorage(db as never);
  const repo = new MessagesRepository(
    new ColdMessagesStorage(db as never),
    parts,
    new ColdRunStepsStorage(db as never),
  );
  return {
    dir,
    dbPath,
    manager,
    db,
    parts,
    repo,
    cleanup: async () => {
      // Windows locks the file while the handle is open — close first.
      try {
        await manager.close();
      } catch {
        // ignore close errors during cleanup
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function pragma(db: unknown, name: string): unknown {
  const client = (db as unknown as { $client: InstanceType<typeof Database> }).$client;
  return client.pragma(name, { simple: true });
}

test('init applies WAL mode and a busy timeout', async () => {
  const { db, cleanup } = await setup();
  try {
    assert.equal(pragma(db, 'journal_mode'), 'wal');
    assert.equal(pragma(db, 'busy_timeout'), 5000);
  } finally {
    await cleanup();
  }
});

test('concurrent writes to message_parts serialize instead of SQLITE_BUSY', async () => {
  const { parts, repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'first part' },
        { type: 'text', text: 'second part' },
      ],
    });
    const existing = await parts.findByMessageId('m1');
    assert.equal(existing.length, 2);

    const shifted = (suffix: string) =>
      existing.map((row) => ({ ...row, text: `${row.text ?? ''}${suffix}` }));

    await Promise.all([
      parts.updateMany(shifted('A')),
      parts.updateMany(shifted('B')),
      parts.insertMany([
        {
          messageId: 'm1',
          position: existing.length,
          type: 'text',
          text: 'concurrent insert',
        },
      ]),
    ]);

    const after = await parts.findByMessageId('m1');
    assert.equal(after.length, 3);
    // Updates must actually land (regression: the tx body once built the
    // queries without .run(), so every update was silently dropped).
    for (const row of after.slice(0, 2)) {
      assert.match(row.text ?? '', /[AB]$/, `update lost for part ${row.id}`);
    }
  } finally {
    await cleanup();
  }
});

test('updateMany persists state transitions on tool parts', async () => {
  const { parts, repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    });
    const [initial] = await parts.findByMessageId('m1');
    await parts.updateMany([{ ...initial, text: 'hello', state: 'done' }]);
    const [updated] = await parts.findByMessageId('m1');
    assert.equal(updated.text, 'hello');
    assert.equal(updated.state, 'done');
  } finally {
    await cleanup();
  }
});

test('checkpoint folds the WAL away so the single file backup is complete', async () => {
  const { dir, manager, repo, cleanup } = await setup();
  try {
    await repo.append('chat-1', {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    });
    await manager.checkpoint();
    await manager.close();
    // The -wal must be gone or zero-length: every frame is folded into the
    // main file. (-shm is shared-memory scratch space, rebuilt on open.)
    const files = await readdir(dir);
    for (const file of files.filter((f) => f.endsWith('-wal'))) {
      const { size } = await stat(join(dir, file));
      assert.equal(size, 0, `${file} still holds uncheckpointed frames`);
    }
    // A fresh client reading only the main file sees all committed rows.
    const reader = new Database(join(dir, 'test.db'), { readonly: true });
    try {
      const row = reader.prepare('select count(*) as n from messages').get() as Record<
        string,
        unknown
      >;
      assert.equal(row.n, 1);
    } finally {
      reader.close();
    }
  } finally {
    await cleanup();
  }
});
