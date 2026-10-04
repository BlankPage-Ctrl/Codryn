import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileRepository, NodeFileSystem, ReadFileService } from '../../src/fm/index.js';

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-read-pagination-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const service = new ReadFileService(new FileRepository(new NodeFileSystem()), dir);
  return { dir, service };
}

function requireOk(result: unknown): {
  content: string;
  contentWithLineNumbers?: string;
  totalLines?: number;
  truncated?: boolean;
} {
  if (typeof result !== 'object' || result === null || !('success' in result)) {
    throw new Error('expected FmResult object');
  }
  const r = result as { success: boolean; data?: unknown };
  assert.equal(r.success, true);
  return r.data as {
    content: string;
    contentWithLineNumbers?: string;
    totalLines?: number;
    truncated?: boolean;
  };
}

test('readFile: far window with small maxBytes returns lines, not empty', async (t) => {
  const { dir, service } = await setup(t);
  // 600 lines x ~100 chars: line 500 starts well beyond byte 12_000.
  const lines = Array.from(
    { length: 600 },
    (_, i) => `line-${String(i + 1).padStart(4, '0')}-` + 'x'.repeat(90),
  );
  await writeFile(join(dir, 'big.ts'), `${lines.join('\n')}\n`);

  const data = requireOk(
    await service.readFile('big.ts', {
      maxBytes: 12_000,
      withLineNumbers: true,
      startLine: 500,
      endLine: 505,
    }),
  );
  assert.equal(data.totalLines, 600);
  assert.ok(
    data.contentWithLineNumbers?.includes('line-0500-'),
    'expected window head, not an empty result',
  );
  assert.ok(data.contentWithLineNumbers?.includes('line-0505-'));
  assert.ok(!data.contentWithLineNumbers?.includes('line-0001-'));
});

test('readFile: no range keeps legacy prefix byte-cap behavior', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.txt'), 'abcdefghijklmnopqrstuvwxyz');
  const data = requireOk(await service.readFile('a.txt', { maxBytes: 10 }));
  assert.equal(data.truncated, true);
  assert.ok(data.contentWithLineNumbers?.includes('abcdefghij'));
});

test('readFile: range within cap is not marked truncated', async (t) => {
  const { dir, service } = await setup(t);
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  await writeFile(join(dir, 'a.txt'), `${lines.join('\n')}\n`);
  const data = requireOk(
    await service.readFile('a.txt', {
      maxBytes: 12_000,
      withLineNumbers: true,
      startLine: 5,
      endLine: 7,
    }),
  );
  assert.equal(data.truncated, false);
  assert.equal(data.totalLines, 20);
  assert.ok(data.contentWithLineNumbers?.includes('line5'));
});

test('readFile: range beyond EOF stays empty with full totalLines', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  const data = requireOk(
    await service.readFile('a.txt', {
      maxBytes: 12_000,
      withLineNumbers: true,
      startLine: 500,
      endLine: 510,
    }),
  );
  assert.equal(data.totalLines, 2);
  assert.equal((data.contentWithLineNumbers ?? '').trim(), '');
});
