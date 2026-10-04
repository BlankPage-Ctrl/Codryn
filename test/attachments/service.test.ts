import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../src/database/database.manager.js';
import { attachments } from '../../src/attachments/schemas/attachments.js';
import { ColdAttachmentsStorage } from '../../src/attachments/storages/cold/attachments.js';
import { FileAttachmentBytesStorage } from '../../src/attachments/storages/cold/bytes.js';
import { AttachmentsRepository } from '../../src/attachments/repository/attachments.js';
import { AttachmentsService } from '../../src/attachments/services/attachments.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const CREATE_TABLE_SQL = [
  "CREATE TABLE `attachments` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `original_filename` text NOT NULL, `stored_filename` text NOT NULL, `media_type` text NOT NULL, `size_bytes` integer NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `created_at` text NOT NULL, `expires_at` text)",
  'CREATE INDEX `attachments_workspace_id_idx` ON `attachments` (`workspace_id`)',
  'CREATE INDEX `attachments_status_expires_idx` ON `attachments` (`status`,`expires_at`)',
];

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), 'codryn-attachments-'));
  const manager = new DatabaseManager({ attachments }, join(dir, 'test.db'));
  return { dir, manager };
}

async function initSchema(f: { dir: string; manager: DatabaseManager<{ attachments: typeof attachments }> }) {
  // DDL via a throwaway client so the test never depends on drizzle DDL APIs.
  const raw = new Database(join(f.dir, 'test.db'));
  try {
    for (const stmt of CREATE_TABLE_SQL) raw.exec(stmt);
  } finally {
    raw.close();
  }
  return f.manager.init();
}

async function makeSvc() {
  const f = makeService();
  const db = await initSchema(f);
  const svc = new AttachmentsService(
    new AttachmentsRepository(new ColdAttachmentsStorage(db)),
    new FileAttachmentBytesStorage(f.dir),
  );
  return { svc, dir: f.dir, manager: f.manager };
}

async function teardown(f: { dir: string; manager: DatabaseManager<{ attachments: typeof attachments }> }) {
  await f.manager.close();
  rmSync(f.dir, { recursive: true, force: true });
}

test('upload stores bytes on disk and pending meta in DB', async () => {
  const f = await makeSvc();
  try {
    const meta = await f.svc.upload({
      workspaceId: 'ws1',
      filename: 'my screenshot.png',
      mediaType: 'image/png',
      dataBase64: PNG_BYTES.toString('base64'),
    });
    assert.equal(meta.workspaceId, 'ws1');
    assert.equal(meta.mediaType, 'image/png');
    assert.equal(meta.status, 'pending');
    assert.ok(meta.expiresAt);
    assert.ok(meta.storedFilename.startsWith(`${meta.id}__`));
    assert.ok(meta.storedFilename.includes('my_screenshot.png'));
    const onDisk = readFileSync(join(f.dir, 'ws1', meta.storedFilename));
    assert.deepEqual(onDisk, PNG_BYTES);
  } finally {
    await teardown(f);
  }
});

test('upload rejects mismatched mime, garbage, and oversize', async () => {
  const f = await makeSvc();
  try {
    await assert.rejects(
      () =>
        f.svc.upload({
          workspaceId: 'ws1',
          filename: 'a.png',
          mediaType: 'image/jpeg',
          dataBase64: PNG_BYTES.toString('base64'),
        }),
      /does not match file content/,
    );
    await assert.rejects(
      () =>
        f.svc.upload({
          workspaceId: 'ws1',
          filename: 'a.png',
          mediaType: 'image/png',
          dataBase64: Buffer.from('not an image at all, just text........').toString('base64'),
        }),
      /magic-byte/,
    );
    await assert.rejects(
      () =>
        f.svc.upload({
          workspaceId: 'ws1',
          filename: 'a.pdf',
          mediaType: 'application/pdf',
          dataBase64: PNG_BYTES.toString('base64'),
        }),
      /Unsupported media type/,
    );
    const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
    PNG_BYTES.copy(huge, 0);
    await assert.rejects(
      () =>
        f.svc.upload({
          workspaceId: 'ws1',
          filename: 'big.png',
          mediaType: 'image/png',
          dataBase64: huge.toString('base64'),
        }),
      /exceeds limit/,
    );
  } finally {
    await teardown(f);
  }
});

test('resolve + link + ownership enforcement', async () => {
  const f = await makeSvc();
  try {
    const meta = await f.svc.upload({
      workspaceId: 'ws1',
      filename: 'a.png',
      mediaType: 'image/png',
      dataBase64: PNG_BYTES.toString('base64'),
    });
    const urls = await f.svc.resolveDataUrls('ws1', [meta.id]);
    assert.ok(urls.get(meta.id)?.startsWith('data:image/png;base64,'));

    await assert.rejects(() => f.svc.resolveDataUrls('ws-other', [meta.id]), /does not belong/);
    await assert.rejects(() => f.svc.resolveDataUrls('ws1', ['00000000-0000-0000-0000-000000000000']), /not found/);

    await f.svc.markLinked('ws1', [meta.id]);
    const after = await f.svc.readForWorkspace('ws1', meta.id);
    assert.equal(after.meta.status, 'linked');
    assert.equal(after.meta.expiresAt, null);
    await assert.rejects(() => f.svc.markLinked('ws-other', [meta.id]), /does not belong/);
  } finally {
    await teardown(f);
  }
});

test('sweep removes only expired pending uploads', async () => {
  const f = await makeSvc();
  try {
    const expired = await f.svc.upload({
      workspaceId: 'ws1',
      filename: 'old.png',
      mediaType: 'image/png',
      dataBase64: PNG_BYTES.toString('base64'),
    });
    const kept = await f.svc.upload({
      workspaceId: 'ws1',
      filename: 'fresh.png',
      mediaType: 'image/png',
      dataBase64: PNG_BYTES.toString('base64'),
    });
    await f.svc.markLinked('ws1', [kept.id]);

    // Sweep with "now" 25h ahead: only the still-pending upload is expired.
    const swept = await f.svc.sweepExpiredPending(new Date(Date.now() + 25 * 60 * 60 * 1000));
    assert.equal(swept.scanned, 1);
    assert.equal(swept.deleted, 1);
    assert.deepEqual(swept.failures, []);
    await assert.rejects(() => f.svc.readForWorkspace('ws1', expired.id), /not found/);
    // linked + fresh pending survive
    await f.svc.readForWorkspace('ws1', kept.id);
  } finally {
    await teardown(f);
  }
});
