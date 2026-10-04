import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  EditFileService,
  FileRepository,
  NodeFileSystem,
  ReadFileService,
  applyEditsAtomic,
  detectLineEnding,
  formatWithLineNumbers,
  normalizeToLf,
  parseContentToLines,
  parseLineNumberedContent,
  toLineNumberedResult,
  unifiedDiff,
} from '../../src/fm/index.js';

test('content: CRLF parses like LF without stray carriage returns', () => {
  const crlf = parseContentToLines('a\r\nb\r\n');
  assert.deepEqual(crlf, [
    { line: 1, text: 'a' },
    { line: 2, text: 'b' },
  ]);
  const lf = parseContentToLines('a\nb\n');
  assert.deepEqual(lf, crlf);
  assert.equal(parseContentToLines('').length, 0);
  assert.deepEqual(parseContentToLines('a\r\n'), [{ line: 1, text: 'a' }]);
  assert.deepEqual(
    parseContentToLines('a\r\nb\nc\r\n').map((l) => l.text),
    ['a', 'b', 'c'],
  );
});

test('content: numbered views never leak carriage returns', () => {
  const numbered = toLineNumberedResult('a\r\nb\r\n');
  assert.equal(numbered.totalLines, 2);
  assert.ok(!numbered.contentWithLineNumbers.includes('\r'));
  assert.ok(numbered.contentWithLineNumbers.includes('a'));
  assert.equal(formatWithLineNumbers('x\r\ny\r\n').includes('\r'), false);
  // Numbered content with CRLF transport still parses back cleanly.
  const back = parseLineNumberedContent('     1\ta\r\n     2\tb\r\n');
  assert.deepEqual(back.map((l) => l.text), ['a', 'b']);
});

test('content: line-ending helpers', () => {
  assert.equal(detectLineEnding('a\r\nb\r\n'), '\r\n');
  assert.equal(detectLineEnding('a\nb\n'), '\n');
  assert.equal(detectLineEnding('no-newline'), '\n');
  assert.equal(normalizeToLf('a\r\nb\r\nc'), 'a\nb\nc');
});

test('diff: CRLF inputs diff without carriage-return noise', () => {
  const r = unifiedDiff('a\r\nb\r\n', 'a\r\nx\r\n');
  assert.ok(r.diff.includes('-b'));
  assert.ok(r.diff.includes('+x'));
  assert.equal(r.diff.includes('\r'), false);
  // Identical modulo line endings is still identical after normalization.
  const same = unifiedDiff('a\r\nb\r\n', 'a\nb\n');
  assert.equal(same.diff, '');
});

test('edit engine: LF search matches CRLF content and preserves CRLF', () => {
  const content = 'line1\r\nline2\r\nline3\r\n';
  const out = applyEditsAtomic(content, [{ search: 'line1\nline2', replace: 'changed' }]);
  assert.equal(out, 'changed\r\nline3\r\n');
  assert.ok(out.includes('\r\n'));
  assert.equal(
    out.split('\n').filter((l) => l.endsWith('\r') === false && l !== '').length,
    0,
  );
});

test('edit engine: CRLF search also matches, LF files stay LF', () => {
  const crlf = applyEditsAtomic('a\r\nb\r\nc', [{ search: 'a\r\nb', replace: 'X' }]);
  assert.equal(crlf, 'X\r\nc');
  const lf = applyEditsAtomic('a\nb\nc', [{ search: 'a\nb', replace: 'X' }]);
  assert.equal(lf, 'X\nc');
  assert.equal(lf.includes('\r'), false);
});

async function setup(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-eol-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const repo = new FileRepository(new NodeFileSystem());
  return { dir, read: new ReadFileService(repo, dir), edit: new EditFileService(repo, dir) };
}

function requireOk<T>(result: { success: boolean; data?: T }): T {
  assert.equal(result.success, true);
  return (result as { data: T }).data;
}

test('read service: CRLF file has clean numbers and CRLF-preserving window', async (t) => {
  const { dir, read } = await setup(t);
  await writeFile(join(dir, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');

  const full = requireOk(await read.readFile('crlf.txt'));
  assert.ok(!String(full.contentWithLineNumbers).includes('\r'));

  const windowed = requireOk(
    await read.readFile('crlf.txt', { startLine: 2, endLine: 3 }),
  ) as { content: string; contentWithLineNumbers?: string; totalLines?: number };
  assert.equal(windowed.totalLines, 3);
  assert.equal(windowed.content, 'two\r\nthree\r\n'.trimEnd());
  assert.ok(windowed.content.includes('\r\n'));
  assert.ok(!String(windowed.contentWithLineNumbers).includes('\r'));
});

test('edit service: LF edit on CRLF file keeps CRLF on disk', async (t) => {
  const { dir, edit } = await setup(t);
  await writeFile(join(dir, 'win.txt'), 'alpha\r\nbeta\r\ngamma\r\n');
  const result = await edit.editFile({
    path: 'win.txt',
    edits: [{ search: 'alpha\nbeta', replace: 'ALPHA' }],
    apply_order: 'forward',
  });
  assert.equal(result.success, true);
  const raw = await readFile(join(dir, 'win.txt'), 'utf8');
  assert.ok(raw.includes('\r\n'));
  assert.equal(raw, 'ALPHA\r\ngamma\r\n');
  if (result.success) {
    assert.equal(result.data.diff.includes('\r'), false);
  }
});
