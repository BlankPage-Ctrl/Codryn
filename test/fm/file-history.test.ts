import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import {
  ColdFileHistoryStorage,
  CreateFileService,
  decompressBlob,
  EditFileService,
  FileRepository,
  FileRevertService,
  hashBytes,
  NodeFileSystem,
} from '../../src/fm/index.js';

const CTX = { workspaceId: 'ws-1', chatId: 'chat-1', messageId: 'a1', runId: 'run-1' };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'fm-history-'));
  const ws = join(dir, 'ws');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(ws, { recursive: true });
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const db = await new DatabaseManager(schema, dbPath).init();
  const fileRepo = new FileRepository(new NodeFileSystem());
  const history = new ColdFileHistoryStorage(db as never);
  const edit = new EditFileService(fileRepo, ws, history);
  const create = new CreateFileService(fileRepo, ws, history);
  const revert = new FileRevertService(fileRepo, history, ws);
  return {
    dir,
    ws,
    db,
    fileRepo,
    history,
    edit,
    create,
    revert,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test('edit records a restorable before-image', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'hello\nworld\n');
    const res = await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'world', replace: 'AI' }], apply_order: 'reverse' },
      { ...CTX, toolCallId: 'call-1' },
    );
    assert.equal(res.success, true);

    const rows = await s.history.listByMessageIds('chat-1', ['a1']);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.op, 'edit');
    assert.equal(row.path, 'a.txt');
    assert.equal(row.existedBefore, 1);
    assert.equal(row.toolCallId, 'call-1');
    assert.equal(row.runId, 'run-1');
    assert.equal(row.beforeHash, hashBytes('hello\nworld\n'));
    assert.equal(row.afterHash, hashBytes('hello\nAI\n'));
    assert.ok(row.beforeBlob);
    assert.equal(decompressBlob(row.beforeBlob).toString('utf-8'), 'hello\nworld\n');
  } finally {
    await s.cleanup();
  }
});

test('edit without context records nothing (opt-in ledger)', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'x');
    const res = await s.edit.editFile({
      path: 'a.txt',
      edits: [{ search: 'x', replace: 'y' }],
      apply_order: 'reverse',
    });
    assert.equal(res.success, true);
    assert.deepEqual(await s.history.listByMessageIds('chat-1', ['a1']), []);
  } finally {
    await s.cleanup();
  }
});

test('create records existedBefore=false; overwrite keeps the before-image', async () => {
  const s = await setup();
  try {
    const created = await s.create.createFile(
      { path: 'new.txt', content: 'fresh', overwrite: false },
      CTX,
    );
    assert.equal(created.success, true);
    let rows = await s.history.listByMessageIds('chat-1', ['a1']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].existedBefore, 0);
    assert.equal(rows[0].beforeBlob, null);

    const over = await s.create.createFile(
      { path: 'new.txt', content: 'v2', overwrite: true },
      { ...CTX, messageId: 'a2' },
    );
    assert.equal(over.success, true);
    rows = await s.history.listByMessageIds('chat-1', ['a2']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].existedBefore, 1);
    assert.equal(decompressBlob(rows[0].beforeBlob!).toString('utf-8'), 'fresh');
  } finally {
    await s.cleanup();
  }
});

test('revert restores edited files to the checkpoint image', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'one\ntwo\n');
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'two', replace: '2' }], apply_order: 'reverse' },
      CTX,
    );
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: '2', replace: 'TWO' }], apply_order: 'reverse' },
      { ...CTX, messageId: 'a2' },
    );

    const out = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['a1', 'a2'],
    });
    assert.deepEqual(out.conflicts, []);
    assert.deepEqual(out.restored, [{ path: 'a.txt', op: 'restored' }]);

    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'one\ntwo\n');
  } finally {
    await s.cleanup();
  }
});

test('revert deletes AI-created files', async () => {
  const s = await setup();
  try {
    await s.create.createFile({ path: 'gen.txt', content: 'ai', overwrite: false }, CTX);
    const out = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['a1'],
    });
    assert.deepEqual(out.conflicts, []);
    assert.deepEqual(out.restored, [{ path: 'gen.txt', op: 'deleted' }]);

    const { stat } = await import('node:fs/promises');
    await assert.rejects(() => stat(join(s.ws, 'gen.txt')), /ENOENT/);
  } finally {
    await s.cleanup();
  }
});

test('out-of-band modification is reported as a conflict and left untouched', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v0', replace: 'v1-ai' }], apply_order: 'reverse' },
      CTX,
    );
    // Another chat (or the user, or shell) changes the file afterwards.
    await writeFile(join(s.ws, 'a.txt'), 'v2-other');

    const out = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['a1'],
    });
    assert.deepEqual(out.restored, []);
    assert.equal(out.conflicts.length, 1);
    assert.equal(out.conflicts[0].path, 'a.txt');
    assert.equal(out.conflicts[0].reason, 'MODIFIED_AFTER');
    assert.equal(out.conflicts[0].lastWriter?.messageId, 'a1');

    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v2-other');

    // Forced revert overwrites despite the collision.
    const forced = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['a1'],
      force: ['a.txt'],
    });
    assert.deepEqual(forced.conflicts, []);
    assert.deepEqual(forced.restored, [{ path: 'a.txt', op: 'restored' }]);
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v0');
  } finally {
    await s.cleanup();
  }
});

test('conflict attributes the last writer across chats', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v0', replace: 'v1' }], apply_order: 'reverse' },
      CTX,
    );
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v1', replace: 'v2' }], apply_order: 'reverse' },
      { workspaceId: 'ws-1', chatId: 'chat-2', messageId: 'b1' },
    );

    const out = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['a1'],
    });
    assert.equal(out.conflicts.length, 1);
    assert.equal(out.conflicts[0].lastWriter?.chatId, 'chat-2');
    assert.equal(out.conflicts[0].lastWriter?.messageId, 'b1');
  } finally {
    await s.cleanup();
  }
});

test('far revert restores the checkpoint before the first in-scope edit', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    // a1 is OUTSIDE the revert scope; a2..a4 are inside.
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v0', replace: 'v1' }], apply_order: 'reverse' },
      CTX,
    );
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v1', replace: 'v2' }], apply_order: 'reverse' },
      { ...CTX, messageId: 'a2' },
    );
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v2', replace: 'v3' }], apply_order: 'reverse' },
      { ...CTX, messageId: 'a3' },
    );
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v3', replace: 'v4' }], apply_order: 'reverse' },
      { ...CTX, messageId: 'a4' },
    );

    const out = await s.revert.revertFromMessages({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      messageIds: ['u2', 'a2', 'u3', 'a3', 'u4', 'a4'],
    });
    assert.deepEqual(out.conflicts, []);
    assert.deepEqual(out.restored, [{ path: 'a.txt', op: 'restored' }]);

    const { readFile } = await import('node:fs/promises');
    // Checkpoint = state before a2's edit (a1's work is preserved).
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v1');
  } finally {
    await s.cleanup();
  }
});

test('preview matches what revert would do', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await writeFile(join(s.ws, 'b.txt'), 'w0');
    await s.edit.editFile(
      { path: 'a.txt', edits: [{ search: 'v0', replace: 'v1' }], apply_order: 'reverse' },
      CTX,
    );
    await s.create.createFile({ path: 'gen.txt', content: 'ai', overwrite: false }, CTX);
    await writeFile(join(s.ws, 'b.txt'), 'w9-manual');

    const req = { workspaceId: 'ws-1', chatId: 'chat-1', messageIds: ['a1'] };
    const preview = await s.revert.previewFromMessages(req);
    const byPath = new Map(preview.files.map((f) => [f.path, f]));
    assert.equal(byPath.get('a.txt')?.status, 'ok');
    assert.equal(byPath.get('a.txt')?.op, 'restored');
    assert.equal(byPath.get('gen.txt')?.status, 'ok');
    assert.equal(byPath.get('gen.txt')?.op, 'deleted');
    // b.txt has no ledger entry, so it does not appear at all.
    assert.equal(byPath.has('b.txt'), false);

    const out = await s.revert.revertFromMessages(req);
    assert.deepEqual(
      out.restored.map((r) => r.path).sort(),
      preview.files
        .filter((f) => f.status === 'ok')
        .map((f) => f.path)
        .sort(),
    );
    assert.deepEqual(out.conflicts, []);

    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v0');
    assert.equal(await readFile(join(s.ws, 'b.txt'), 'utf-8'), 'w9-manual');
  } finally {
    await s.cleanup();
  }
});
