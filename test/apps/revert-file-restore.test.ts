import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { previewMessageRun } from '../../apps/actions/preview.message-run.js';
import { revertMessageRun } from '../../apps/actions/revert.message-run.js';
import type { Container } from '../../apps/bootstrap.js';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import {
  ColdFileHistoryStorage,
  EditFileService,
  FileRepository,
  NodeFileSystem,
} from '../../src/fm/index.js';
import { MessagesService } from '../../src/messages/index.js';
import { MessagesRepository } from '../../src/messages/repository/messages.js';
import { ColdMessagesStorage } from '../../src/messages/storages/cold/messages.js';
import { ColdMessagePartsStorage } from '../../src/messages/storages/cold/message-parts.js';
import { ColdRunStepsStorage } from '../../src/messages/storages/cold/run-steps.js';
import { RunHotStorage, RunsRepository, RunsService } from '../../src/runs/index.js';

const WS_ID = 'ws-1';
const CHAT_ID = 'chat-1';

const umsg = (id: string) => ({
  id,
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: `q-${id}` }],
});
const amsg = (id: string) => ({
  id,
  role: 'assistant' as const,
  parts: [{ type: 'text' as const, text: `a-${id}` }],
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'revert-action-'));
  const ws = join(dir, 'ws');
  await mkdir(ws, { recursive: true });
  const dbPath = join(dir, 'test.db');
  await runMigrations(dbPath);
  const db = await new DatabaseManager(schema, dbPath).init();
  const messagesRepo = new MessagesRepository(
    new ColdMessagesStorage(db as never),
    new ColdMessagePartsStorage(db as never),
    new ColdRunStepsStorage(db as never),
  );
  const messagesService = new MessagesService(messagesRepo);
  const fileRepo = new FileRepository(new NodeFileSystem());
  const fileHistoryStorage = new ColdFileHistoryStorage(db as never);
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));
  const ctx = {
    chatService: { findOne: async () => ({ id: CHAT_ID }) },
    workspacesService: { findOne: async () => ({ id: WS_ID, projectPath: ws }) },
    messagesService,
    runService,
    fileRepo,
    fileHistoryStorage,
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  } as unknown as Container;
  const edit = new EditFileService(fileRepo, ws, fileHistoryStorage);
  return {
    dir,
    ws,
    ctx,
    edit,
    fileHistoryStorage,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const editCall = (search: string, replace: string) => ({
  path: 'a.txt',
  edits: [{ search, replace }],
  apply_order: 'reverse' as const,
});

test('revert with restoreFiles deletes the suffix and restores the file', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await s.ctx.messagesService.append(CHAT_ID, umsg('u1'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a1'));
    await s.ctx.messagesService.append(CHAT_ID, umsg('u2'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a2'));
    await s.edit.editFile(editCall('v0', 'v1-ai'), {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'a2',
    });

    const out = await revertMessageRun(s.ctx, {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'u2',
      mode: 'conversation',
      restoreFiles: true,
    });

    assert.deepEqual(out.deletedMessageIds, ['u2', 'a2']);
    assert.deepEqual(out.cancelledRunIds, []);
    assert.deepEqual(out.fileRestore?.conflicts, []);
    assert.deepEqual(out.fileRestore?.restored, [{ path: 'a.txt', op: 'restored' }]);
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v0');

    const remaining = await s.ctx.messagesService.load(CHAT_ID);
    assert.deepEqual(
      remaining.map((m) => m.id),
      ['u1', 'a1'],
    );

    // Consumed entries are gone.
    assert.deepEqual(await s.fileHistoryStorage.listByMessageIds(CHAT_ID, ['a2']), []);
  } finally {
    await s.cleanup();
  }
});

test('revert without restoreFiles leaves files untouched (conversation-only)', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await s.ctx.messagesService.append(CHAT_ID, umsg('u1'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a1'));
    await s.edit.editFile(editCall('v0', 'v1-ai'), {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'a1',
    });

    const out = await revertMessageRun(s.ctx, {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'u1',
      mode: 'conversation',
    });

    assert.equal(out.fileRestore, undefined);
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v1-ai');
    // Ledger untouched when files are not restored.
    assert.equal((await s.fileHistoryStorage.listByMessageIds(CHAT_ID, ['a1'])).length, 1);
  } finally {
    await s.cleanup();
  }
});

test('conflicted paths are skipped and their ledger entries are retained', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await writeFile(join(s.ws, 'b.txt'), 'w0');
    await s.ctx.messagesService.append(CHAT_ID, umsg('u1'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a1'));
    await s.edit.editFile(editCall('v0', 'v1-ai'), {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'a1',
    });
    await s.edit.editFile(
      { path: 'b.txt', edits: [{ search: 'w0', replace: 'w1-ai' }], apply_order: 'reverse' },
      { workspaceId: WS_ID, chatId: CHAT_ID, messageId: 'a1' },
    );
    // Out-of-band change to b.txt after the AI edits.
    await writeFile(join(s.ws, 'b.txt'), 'w2-manual');

    const out = await revertMessageRun(s.ctx, {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'u1',
      mode: 'conversation',
      restoreFiles: true,
    });

    assert.deepEqual(out.fileRestore?.restored, [{ path: 'a.txt', op: 'restored' }]);
    assert.equal(out.fileRestore?.conflicts.length, 1);
    assert.equal(out.fileRestore?.conflicts[0]?.path, 'b.txt');
    assert.equal(await readFile(join(s.ws, 'b.txt'), 'utf-8'), 'w2-manual');

    // The a1 entries touched a conflicted path, so they are retained for
    // future (earlier) reverts to still detect the collision.
    assert.equal((await s.fileHistoryStorage.listByMessageIds(CHAT_ID, ['a1'])).length, 2);
  } finally {
    await s.cleanup();
  }
});

test('preview reports the plan without deleting or restoring anything', async () => {
  const s = await setup();
  try {
    await writeFile(join(s.ws, 'a.txt'), 'v0');
    await s.ctx.messagesService.append(CHAT_ID, umsg('u1'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a1'));
    await s.ctx.messagesService.append(CHAT_ID, umsg('u2'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a2'));
    await s.edit.editFile(editCall('v0', 'v1-ai'), {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'a2',
    });
    await writeFile(join(s.ws, 'a.txt'), 'v2-manual');

    const preview = await previewMessageRun(s.ctx, {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'u2',
      mode: 'conversation',
    });

    assert.deepEqual(preview.suffixIds, ['u2', 'a2']);
    assert.equal(preview.files.length, 1);
    assert.equal(preview.files[0]?.path, 'a.txt');
    assert.equal(preview.files[0]?.status, 'conflict');
    assert.equal(preview.files[0]?.reason, 'MODIFIED_AFTER');

    // Nothing was deleted or restored.
    const remaining = await s.ctx.messagesService.load(CHAT_ID);
    assert.deepEqual(
      remaining.map((m) => m.id),
      ['u1', 'a1', 'u2', 'a2'],
    );
    assert.equal(await readFile(join(s.ws, 'a.txt'), 'utf-8'), 'v2-manual');
    assert.equal((await s.fileHistoryStorage.listByMessageIds(CHAT_ID, ['a2'])).length, 1);
  } finally {
    await s.cleanup();
  }
});

test('preview of a suffix with no file edits reports zero files', async () => {
  const s = await setup();
  try {
    await s.ctx.messagesService.append(CHAT_ID, umsg('u1'));
    await s.ctx.messagesService.append(CHAT_ID, amsg('a1'));

    const preview = await previewMessageRun(s.ctx, {
      workspaceId: WS_ID,
      chatId: CHAT_ID,
      messageId: 'u1',
      mode: 'conversation',
    });

    assert.deepEqual(preview.files, []);
    assert.deepEqual(preview.suffixIds, ['u1', 'a1']);
  } finally {
    await s.cleanup();
  }
});
