import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  EditFileService,
  FileRepository,
  NodeFileSystem,
  unifiedDiff,
} from '../../src/fm/index.js';

function numbered(n: number, changed?: Map<number, string>): string {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(changed?.get(i) ?? `line${i}`);
  }
  return lines.join('\n');
}

test('diff: identical contents produce empty diff', () => {
  const r = unifiedDiff('a\nb\n', 'a\nb\n');
  assert.equal(r.diff, '');
  assert.equal(r.truncated, false);
});

test('diff: empty inputs', () => {
  assert.deepEqual(unifiedDiff('', ''), { diff: '', truncated: false });
  const r = unifiedDiff('', 'x\ny');
  assert.ok(r.diff.includes('@@ -1,0 +1,2 @@'));
  assert.ok(r.diff.includes('+x'));
  assert.equal(r.truncated, false);
});

test('diff: single change gets one hunk with 3 context lines', () => {
  const before = numbered(10);
  const after = numbered(10, new Map([[5, 'CHANGED']]));
  const r = unifiedDiff(before, after);
  assert.equal(r.truncated, false);
  const lines = r.diff.split('\n');
  assert.equal(lines[0], '@@ -2,7 +2,7 @@');
  assert.ok(lines.includes('-line5'));
  assert.ok(lines.includes('+CHANGED'));
  assert.ok(lines.includes(' line2'));
  assert.ok(lines.includes(' line8'));
  assert.ok(!lines.includes(' line1'));
  assert.ok(!lines.includes(' line9'));
});

test('diff: distant changes produce separate hunks', () => {
  const before = numbered(30);
  const after = numbered(
    30,
    new Map([
      [3, 'A'],
      [27, 'B'],
    ]),
  );
  const r = unifiedDiff(before, after);
  const headers = r.diff.split('\n').filter((l) => l.startsWith('@@'));
  assert.equal(headers.length, 2);
  assert.ok(r.diff.includes('-line3'));
  assert.ok(r.diff.includes('+A'));
  assert.ok(r.diff.includes('-line27'));
  assert.ok(r.diff.includes('+B'));
});

test('diff: insertion and deletion at boundaries', () => {
  const r = unifiedDiff('b\nc', 'a\nb\nc\nd');
  assert.ok(r.diff.includes('+a'));
  assert.ok(r.diff.includes('+d'));
  assert.equal(r.truncated, false);
});

test('diff: output cap truncates with marker', () => {
  const before = numbered(40);
  const after = numbered(
    40,
    new Map([
      [5, 'A'],
      [35, 'B'],
    ]),
  );
  const r = unifiedDiff(before, after, { maxOutputLines: 5 });
  assert.equal(r.truncated, true);
  assert.ok(r.diff.includes('... (diff truncated)'));
});

test('diff: input cap skips with truncated flag', () => {
  const r = unifiedDiff('a\nb\nc', 'a\nx\nc', { maxInputLines: 2 });
  assert.equal(r.diff, '');
  assert.equal(r.truncated, true);
});

test('diff: delta cap aborts pathological rewrite', () => {
  const before = numbered(50);
  const after = numbered(
    50,
    new Map(Array.from({ length: 50 }, (_, i) => [i + 1, `z${i}`] as [number, string])),
  );
  const r = unifiedDiff(before, after, { maxDelta: 5 });
  assert.equal(r.diff, '');
  assert.equal(r.truncated, true);
});

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-edit-diff-'));
  const service = new EditFileService(new FileRepository(new NodeFileSystem()), dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('editFile: returns unified diff of the exact base edited', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.txt'), numbered(10));
  const result = await service.editFile({
    apply_order: 'reverse',
    path: 'a.txt',
    edits: [{ search: 'line5', replace: 'CHANGED', hint: { startLine: 5, endLine: 5 } }],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.diffTruncated, false);
  const diff = result.data.diff ?? '';
  assert.ok(diff.startsWith('@@ -2,7 +2,7 @@'));
  assert.ok(diff.includes('-line5'));
  assert.ok(diff.includes('+CHANGED'));
});
