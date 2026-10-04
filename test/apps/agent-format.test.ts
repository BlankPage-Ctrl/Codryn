import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileNode } from '../../src/fm/types/index.js';
import { FileType } from '../../src/fm/types/index.js';
import {
  formatGrep,
  formatGrepError,
  formatListDir,
  formatReadFile,
  formatToolError,
  humanizeSize,
} from '../../apps/agent/tools/format.js';

function file(name: string, size?: number): FileNode {
  return {
    id: `id-${name}`,
    name,
    path: name,
    type: FileType.FILE,
    isDirectory: false,
    ...(size === undefined ? {} : { size }),
  };
}

function dir(name: string, hasChildren?: boolean): FileNode {
  return {
    id: `id-${name}`,
    name,
    path: name,
    type: FileType.DIRECTORY,
    isDirectory: true,
    ...(hasChildren === undefined ? {} : { hasChildren }),
  };
}

function symlink(name: string, target?: string): FileNode {
  return {
    id: `id-${name}`,
    name,
    path: name,
    type: FileType.SYMLINK,
    isDirectory: false,
    ...(target === undefined
      ? { meta: { isSymlink: true } }
      : { meta: { isSymlink: true, symlinkTarget: target } }),
  };
}

test('humanizeSize: formats bytes compactly', () => {
  assert.equal(humanizeSize(0), '0B');
  assert.equal(humanizeSize(512), '512B');
  assert.equal(humanizeSize(1023), '1023B');
  assert.equal(humanizeSize(1024), '1kb');
  assert.equal(humanizeSize(2150), '2.1kb');
  assert.equal(humanizeSize(15_000_000), '14.3mb');
});

test('formatListDir: dirs first, sizes, empty marker, counts', () => {
  const out = formatListDir('.', [
    file('b.ts', 2150),
    dir('src'),
    file('a.ts', 512),
    dir('empty-dir', false),
  ]);
  assert.equal(
    out,
    [
      '`.` — 4 entries (2 dirs, 2 files)',
      '- `empty-dir/` (empty)',
      '- `src/`',
      '- `a.ts` (512B)',
      '- `b.ts` (2.1kb)',
    ].join('\n'),
  );
});

test('formatListDir: symlinks show target', () => {
  const out = formatListDir('.', [symlink('link', 'src/index.ts'), file('a.ts', 10)]);
  assert.equal(
    out,
    [
      '`.` — 2 entries (0 dirs, 1 file, 1 link)',
      '- `a.ts` (10B)',
      '- `link` -> `src/index.ts`',
    ].join('\n'),
  );
});

test('formatListDir: node_modules/.git hidden by default with footer', () => {
  const out = formatListDir('.', [dir('node_modules'), dir('.git'), file('a.ts', 1)]);
  assert.equal(
    out,
    [
      '`.` — 1 entry (0 dirs, 1 file)',
      '- `a.ts` (1B)',
      '_2 entries filtered (node_modules, .git)_',
    ].join('\n'),
  );

  const shown = formatListDir('.', [dir('node_modules'), file('a.ts', 1)], {
    includeIgnored: true,
  });
  assert.ok(shown.includes('`node_modules/`'));
  assert.ok(!shown.includes('filtered'));
});

test('formatListDir: cap slices with +N more footer', () => {
  const nodes = Array.from({ length: 5 }, (_, i) => file(`f${i}.ts`, 1));
  const out = formatListDir('.', nodes, { limit: 2 });
  assert.equal(
    out,
    [
      '`.` — 2 of 5 shown (0 dirs, 5 files)',
      '- `f0.ts` (1B)',
      '- `f1.ts` (1B)',
      '... +3 more (list a subdirectory for the rest)',
    ].join('\n'),
  );
});

test('formatListDir: empty dir without noise', () => {
  assert.equal(formatListDir('src', []), '`src` — empty');
});

test('formatReadFile: header range + truncation hint', () => {
  const out = formatReadFile({
    path: 'a.ts',
    content: 'x',
    contentWithLineNumbers: '     1\tx',
    encoding: 'utf-8',
    size: 1,
    truncated: true,
    totalLines: 240,
  });
  assert.ok(out.startsWith('# `a.ts` — lines 1–240 of 240'));
  assert.ok(out.includes('_(truncated, use startLine=241 to continue)_'));
});

test('formatReadFile: paginated range respected', () => {
  const out = formatReadFile(
    {
      path: 'a.ts',
      content: 'x',
      contentWithLineNumbers: '    11\tx',
      encoding: 'utf-8',
      size: 1,
      truncated: false,
      totalLines: 240,
    },
    { startLine: 11, endLine: 11 },
  );
  assert.ok(out.startsWith('# `a.ts` — lines 11–11 of 240'));
  assert.ok(!out.includes('truncated'));
});

test('formatReadFile: base64 shows size, no line header', () => {
  const out = formatReadFile({
    path: 'img.png',
    content: 'aGk=',
    encoding: 'base64',
    size: 2048,
    truncated: false,
  });
  assert.ok(out.startsWith('# `img.png` (base64, 2kb)'));
});

test('formatToolError: one-liner with code', () => {
  assert.equal(
    formatToolError('PATH_NOT_FOUND', 'not found', 'foo'),
    "Error [PATH_NOT_FOUND]: not found ('foo')",
  );
  assert.equal(formatToolError('X', 'y'), 'Error [X]: y');
});

test('formatGrep: groups matches per file with line numbers', () => {
  const out = formatGrep({
    pattern: 'hello',
    truncated: false,
    matches: [
      { path: 'b.ts', line: 1, column: 1, text: 'hello world' },
      { path: 'a.ts', line: 2, column: 7, text: 'say hello' },
      { path: 'a.ts', line: 9, column: 1, text: 'hello again' },
    ],
  });
  assert.equal(
    out,
    [
      '# grep "hello" — 3 matches',
      '## `b.ts`',
      '- L1:C1: `hello world`',
      '## `a.ts`',
      '- L2:C7: `say hello`',
      '- L9:C1: `hello again`',
    ].join('\n'),
  );
});

test('formatGrep: truncated source adds refine hint', () => {
  const out = formatGrep({
    pattern: 'x',
    truncated: true,
    matches: [{ path: 'a.ts', line: 1, column: 1, text: 'x' }],
  });
  assert.ok(out.includes('_(truncated at source, refine the pattern or narrow path/include)_'));
});

test('formatGrep: empty matches suggest next steps', () => {
  const out = formatGrep({ pattern: 'zzz', truncated: false, matches: [] });
  assert.ok(out.startsWith('`.` — no matches for "zzz"'));
  assert.ok(out.includes('`regex: false`'));
});

test('formatGrep: maxShown caps with +N more footer', () => {
  const matches = Array.from({ length: 5 }, (_, i) => ({
    path: 'a.ts',
    line: i + 1,
    column: 1,
    text: 'x',
  }));
  const out = formatGrep({ pattern: 'x', truncated: false, matches }, { maxShown: 2 });
  assert.ok(out.startsWith('# grep "x" — 2 of 5 shown'));
  assert.ok(out.includes('... +3 more (narrow path/include or raise maxResults)'));
});

test('formatGrep: files_with_matches lists files without match lines', () => {
  const out = formatGrep(
    {
      pattern: 'hello',
      truncated: false,
      matches: [
        { path: 'b.ts', line: 1, column: 1, text: 'hello world' },
        { path: 'a.ts', line: 2, column: 7, text: 'say hello' },
        { path: 'a.ts', line: 9, column: 1, text: 'hello again' },
      ],
    },
    { outputMode: 'files_with_matches' },
  );
  assert.equal(
    out,
    ['# grep "hello" — 2 files (3 matches)', '- `b.ts` (1 match)', '- `a.ts` (2 matches)'].join(
      '\n',
    ),
  );
});

test('formatGrep: count shows per-file totals', () => {
  const out = formatGrep(
    {
      pattern: 'hello',
      truncated: false,
      matches: [
        { path: 'b.ts', line: 1, column: 1, text: 'hello world' },
        { path: 'a.ts', line: 2, column: 7, text: 'say hello' },
        { path: 'a.ts', line: 9, column: 1, text: 'hello again' },
      ],
    },
    { outputMode: 'count' },
  );
  assert.equal(
    out,
    ['# grep "hello" — 3 occurrences across 2 files', '- `b.ts`: 1', '- `a.ts`: 2'].join('\n'),
  );
});

test('formatGrepError: per-code suggestions', () => {
  assert.ok(
    formatGrepError('INVALID_INPUT', 'Invalid grep pattern: foo').includes('`regex: false`'),
  );
  assert.ok(formatGrepError('PATH_TRAVERSAL', 'Path traversal', '../x').includes('relative path'));
  assert.ok(formatGrepError('PATH_NOT_FOUND', 'missing', 'nope').includes('`list_files`'));
});
