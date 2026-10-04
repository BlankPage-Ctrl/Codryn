import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  EditFileService,
  FileRepository,
  NodeFileSystem,
  withFileLock,
} from '../../src/fm/index.js';

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-edit-lock-'));
  const service = new EditFileService(new FileRepository(new NodeFileSystem()), dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('editFile: concurrent edits to the same file all apply (no lost updates)', async (t) => {
  const { dir, service } = await setup(t);
  const count = 20;
  const base = Array.from({ length: count }, (_, i) => `key-${i}: v0`).join('\n');
  await writeFile(join(dir, 'shared.txt'), base);

  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      service.editFile({
        apply_order: 'reverse',
        path: 'shared.txt',
        edits: [{ search: `key-${i}: v0`, replace: `key-${i}: v1` }],
      }),
    ),
  );
  for (const r of results) {
    assert.equal(r.success, true);
  }
  const final = await readFile(join(dir, 'shared.txt'), 'utf-8');
  for (let i = 0; i < count; i++) {
    assert.ok(final.includes(`key-${i}: v1`), `missing edit ${i}`);
  }
  assert.ok(!final.includes('v0'));
});

test('editFile: lock is released on failure, later edits proceed', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'b.txt'), 'hello\nworld');

  const [failed, ok] = await Promise.all([
    service.editFile({
      apply_order: 'reverse',
      path: 'b.txt',
      edits: [{ search: 'missing', replace: 'x' }],
    }),
    service.editFile({
      apply_order: 'reverse',
      path: 'b.txt',
      edits: [{ search: 'hello', replace: 'hi' }],
    }),
  ]);
  assert.equal(failed.success, false);
  if (failed.success) return;
  assert.equal(failed.error.code, 'EDIT_FAILED');
  assert.equal(ok.success, true);

  const after = await service.editFile({
    apply_order: 'reverse',
    path: 'b.txt',
    edits: [{ search: 'world', replace: 'earth' }],
  });
  assert.equal(after.success, true);
  const final = await readFile(join(dir, 'b.txt'), 'utf-8');
  assert.ok(final.includes('hi'));
  assert.ok(final.includes('earth'));
});

test('withFileLock: propagates fn errors and still releases', async () => {
  const order: string[] = [];
  await assert.rejects(
    withFileLock('k', async () => {
      order.push('first');
      throw new Error('boom');
    }),
    /boom/,
  );
  await withFileLock('k', async () => {
    order.push('second');
  });
  assert.deepEqual(order, ['first', 'second']);
});

test('withFileLock: different keys run independently', async () => {
  const done: string[] = [];
  await Promise.all([
    withFileLock('a', async () => {
      done.push('a');
    }),
    withFileLock('b', async () => {
      done.push('b');
    }),
  ]);
  assert.equal(done.length, 2);
});
