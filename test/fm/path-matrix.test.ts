import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, posix, win32 } from 'node:path';
import { test } from 'node:test';
import {
  FileRepository,
  NodeFileSystem,
  ReadFileService,
  classifyWorkspacePath,
  isOutsideDisplayPath,
  isOutsideRelative,
} from '../../src/fm/index.js';

/** Same rule as classifyWorkspacePath but with an injectable path impl. */
function classifyWith(
  p: typeof posix | typeof win32,
  root: string,
  requestedPath: string,
): { inside: boolean; absolutePath: string; relative: string } {
  const normalizedRoot = p.resolve(root);
  const resolved = p.resolve(normalizedRoot, requestedPath === '/' ? '.' : requestedPath);
  const relative = p.relative(normalizedRoot, resolved);
  const outside = isOutsideRelative(relative, { sep: p.sep, isAbsolute: p.isAbsolute });
  return { inside: !outside, absolutePath: resolved, relative };
}

test('isOutsideRelative: posix segments', () => {
  const o = { sep: posix.sep, isAbsolute: posix.isAbsolute };
  assert.equal(isOutsideRelative('', o), false);
  assert.equal(isOutsideRelative('a/b', o), false);
  assert.equal(isOutsideRelative('..', o), true);
  assert.equal(isOutsideRelative('../x', o), true);
  assert.equal(isOutsideRelative('../../etc/passwd', o), true);
  assert.equal(isOutsideRelative('/etc/passwd', o), true);
  // Regression: valid filenames starting with dots stay inside.
  assert.equal(isOutsideRelative('..foo', o), false);
  assert.equal(isOutsideRelative('..foo/bar', o), false);
  assert.equal(isOutsideRelative('.foo', o), false);
});

test('isOutsideRelative: win32 segments (runs on any host)', () => {
  const o = { sep: win32.sep, isAbsolute: win32.isAbsolute };
  assert.equal(isOutsideRelative('a\\b', o), false);
  assert.equal(isOutsideRelative('..', o), true);
  assert.equal(isOutsideRelative('..\\x', o), true);
  assert.equal(isOutsideRelative('..\\..\\Windows', o), true);
  assert.equal(isOutsideRelative('C:\\other\\x', o), true);
  assert.equal(isOutsideRelative('D:\\x', o), true);
  assert.equal(isOutsideRelative('..foo', o), false);
  assert.equal(isOutsideRelative('..foo\\bar', o), false);
});

test('isOutsideDisplayPath: always posix-style', () => {
  assert.equal(isOutsideDisplayPath('/'), false);
  assert.equal(isOutsideDisplayPath('a/b'), false);
  assert.equal(isOutsideDisplayPath('..'), true);
  assert.equal(isOutsideDisplayPath('../x'), true);
  assert.equal(isOutsideDisplayPath('..foo'), false);
  assert.equal(isOutsideDisplayPath('..foo/bar'), false);
});

test('posix simulation: inside vs outside', () => {
  const root = '/ws/project';
  assert.equal(classifyWith(posix, root, './src/foo.ts').inside, true);
  assert.equal(classifyWith(posix, root, 'a.txt').inside, true);
  assert.equal(classifyWith(posix, root, '.').inside, true);
  assert.equal(classifyWith(posix, root, '/').inside, true);
  assert.equal(classifyWith(posix, root, '..foo').inside, true);
  assert.equal(classifyWith(posix, root, '..foo/bar').inside, true);
  assert.equal(classifyWith(posix, root, '../escape').inside, false);
  assert.equal(classifyWith(posix, root, '/etc/passwd').inside, false);
  assert.equal(classifyWith(posix, root, '/ws/other/x').inside, false);
});

test('win32 simulation: drive letters, separators, traversal', () => {
  const root = 'C:\\ws\\project';
  // Forward and back slashes are both separators on Windows.
  assert.equal(classifyWith(win32, root, 'src\\foo.ts').inside, true);
  assert.equal(classifyWith(win32, root, 'src/foo.ts').inside, true);
  assert.equal(classifyWith(win32, root, '.\\a.txt').inside, true);
  assert.equal(classifyWith(win32, root, '..foo').inside, true);
  assert.equal(classifyWith(win32, root, '..foo\\bar').inside, true);
  assert.equal(classifyWith(win32, root, '..\\escape').inside, false);
  assert.equal(classifyWith(win32, root, '../escape').inside, false);
  assert.equal(classifyWith(win32, root, 'C:\\other\\x').inside, false);
  assert.equal(classifyWith(win32, root, 'D:\\x').inside, false);
  assert.equal(classifyWith(win32, root, '\\\\server\\share\\x').inside, false);
});

test('classifyWorkspacePath: live host matrix', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'fm-matrix-ws-'));
  const outside = await mkdtemp(join(tmpdir(), 'fm-matrix-out-'));
  t.after(async () => {
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  assert.equal(classifyWorkspacePath(ws, '.').inside, true);
  assert.equal(classifyWorkspacePath(ws, './src/foo.ts').inside, true);
  assert.equal(classifyWorkspacePath(ws, join('sub', 'file.txt')).inside, true);
  // Backslash input stays inside on every host (subdir on win32,
  // literal filename char on posix) - it must never escape.
  assert.equal(classifyWorkspacePath(ws, 'src\\foo.ts').inside, true);
  // Regression: dot-prefixed names are not traversal.
  assert.equal(classifyWorkspacePath(ws, '..foo').inside, true);
  assert.equal(classifyWorkspacePath(ws, join('..foo', 'bar.txt')).inside, true);

  assert.equal(classifyWorkspacePath(ws, '../escape').inside, false);
  assert.equal(classifyWorkspacePath(ws, outside).inside, false);
  assert.equal(classifyWorkspacePath(ws, join(outside, 'x.txt')).inside, false);
  // Absolute path inside the workspace resolves back inside.
  assert.equal(classifyWorkspacePath(ws, join(ws, 'inner.txt')).inside, true);
  void path;
});

test('live fs: file named ..foo is readable inside the workspace', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'fm-matrix-dotfile-'));
  t.after(async () => {
    await rm(ws, { recursive: true, force: true });
  });
  await writeFile(join(ws, '..foo'), 'dot-name-content');
  const service = new ReadFileService(new FileRepository(new NodeFileSystem()), ws);
  assert.equal(classifyWorkspacePath(ws, '..foo').inside, true);
  const result = await service.readFile('..foo', { withLineNumbers: false });
  assert.equal(result.success, true);
});
