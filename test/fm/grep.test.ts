import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  GrepRepository,
  GrepService,
  GrepStorage,
  isFmPendingApproval,
  type GrepData,
} from '../../src/fm/index.js';

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-grep-'));
  const service = new GrepService(new GrepRepository(new GrepStorage()), dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('grep: returns path, 1-based line number, and code text', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(
    join(dir, 'app.ts'),
    'import x from "y";\nconst hello = 1;\nconsole.log(hello);\n',
  );

  const result = await service.grep('', 'hello');
  assert.equal(result.success, true);
  if (!result.success) return;
  const data: GrepData = result.data;
  assert.equal(data.pattern, 'hello');
  assert.deepEqual(
    data.matches.map((m) => [m.path, m.line, m.text]),
    [
      ['app.ts', 2, 'const hello = 1;'],
      ['app.ts', 3, 'console.log(hello);'],
    ],
  );
});

test('grep: regex pattern works by default', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'foo123\nfoo\nfoobar\n');

  const result = await service.grep('', 'foo\\d+');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.matches.length, 1);
  assert.equal(result.data.matches[0]?.text, 'foo123');
});

test('grep: regex:false treats pattern as literal', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'foo(bar\nfoobar\n');

  const result = await service.grep('', 'foo(bar', { regex: false });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.matches.length, 1);
  assert.equal(result.data.matches[0]?.text, 'foo(bar');
});

test('grep: caseInsensitive:false is case-sensitive', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'Hello\nhello\n');

  const result = await service.grep('', 'hello', { caseInsensitive: false });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((m) => m.line),
    [2],
  );
});

test('grep: folders[] restricts the search roots', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'src', 'code.ts'), 'needle here\n');
  await writeFile(join(dir, 'docs', 'readme.md'), 'needle here\n');

  const result = await service.grep('', 'needle', { folders: ['src'] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((m) => m.path),
    ['src/code.ts'],
  );
});

test('grep: files[] allowlist is AND-combined with the roots', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'keep.ts'), 'needle\n');
  await writeFile(join(dir, 'drop.ts'), 'needle\n');

  const result = await service.grep('', 'needle', { files: ['keep.ts'] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((m) => m.path),
    ['keep.ts'],
  );
});

test('grep: include[] restricts by glob', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'needle\n');
  await writeFile(join(dir, 'b.md'), 'needle\n');

  const result = await service.grep('', 'needle', { include: ['*.ts'] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((m) => m.path),
    ['a.ts'],
  );
});

test('grep: respects default ignores (node_modules)', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'lib.js'), 'needle\n');
  await writeFile(join(dir, 'src.ts'), 'needle\n');

  const result = await service.grep('', 'needle');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((m) => m.path),
    ['src.ts'],
  );
});

test('grep: no match returns empty success', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'something\n');

  const result = await service.grep('', 'zzz-no-such-content');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.matches, []);
  assert.equal(result.data.truncated, false);
});

test('grep: empty pattern returns empty success', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'something\n');

  const result = await service.grep('', '   ');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.matches, []);
});

test('grep: invalid regex returns INVALID_INPUT', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'something\n');

  const result = await service.grep('', '([');
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'INVALID_INPUT');
  }
});

test('grep: traversal in folders needs approval (not silent deny)', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'something\n');

  const result = await service.grep('', 'something', { folders: ['../..'] });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'REQUIRES_APPROVAL');
  }
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  const denied = await result.confirm({ decision: 'deny' });
  assert.equal(denied.success, false);
  if (denied.success) return;
  assert.equal(denied.error.code, 'PERMISSION_DENIED');
});

test('grep: truncates at maxResults', async (t) => {
  const { dir, service } = await setup(t);
  const lines = Array.from({ length: 20 }, (_, i) => `needle ${i}`).join('\n');
  await writeFile(join(dir, 'big.ts'), `${lines}\n`);

  const result = await service.grep('', 'needle', { maxResults: 5 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.matches.length, 5);
  assert.equal(result.data.truncated, true);
});

test('resolveRgPath: CODRYN_RG_PATH override wins when the file exists', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-rgpath-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const fake = join(dir, 'my-rg');
  await writeFile(fake, 'fake');
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(resolveRgPath({ env: { CODRYN_RG_PATH: fake } }), fake);
});

test('resolveRgPath: explicit override to a missing file throws', async () => {
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.throws(
    () => resolveRgPath({ env: { CODRYN_RG_PATH: '/no/such/rg' } }),
    /ripgrep binary not found: \/no\/such\/rg \(from CODRYN_RG_PATH\)/,
  );
});

function makeProdHome(t: { after: (fn: () => void) => void }, files: string[]): string {
  const home = mkdtempSync(join(tmpdir(), 'fm-rghome-'));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
  });
  const dir = join(home, 'codryn', 'backend', 'bin', 'rg');
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), 'fake');
  return home;
}

test('resolveRgPath: prod dir lookup finds versioned rg (posix)', async (t) => {
  const home = makeProdHome(t, ['rg-v13.0.0-x86_64-unknown-linux-musl']);
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(
    resolveRgPath({ env: {}, homeDir: home, platform: 'linux' }),
    join(home, 'codryn', 'backend', 'bin', 'rg', 'rg-v13.0.0-x86_64-unknown-linux-musl'),
  );
});

test('resolveRgPath: prod dir lookup finds versioned rg.exe on win32', async (t) => {
  const home = makeProdHome(t, ['rg-v13.0.0-x86_64-pc-windows-msvc.exe']);
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(
    resolveRgPath({ env: {}, homeDir: home, platform: 'win32' }),
    join(home, 'codryn', 'backend', 'bin', 'rg', 'rg-v13.0.0-x86_64-pc-windows-msvc.exe'),
  );
});

test('findRgInDir: plain rg without version is ignored', async (t) => {
  const home = makeProdHome(t, ['rg']);
  const { findRgInDir } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(findRgInDir(join(home, 'codryn', 'backend', 'bin', 'rg'), 'linux'), null);
});

test('resolveRgPath: highest version wins', async (t) => {
  const home = makeProdHome(t, [
    'rg-v13.0.0-x86_64-unknown-linux-musl',
    'rg-v14.1.0-x86_64-unknown-linux-musl',
  ]);
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(
    resolveRgPath({ env: {}, homeDir: home, platform: 'linux' }),
    join(home, 'codryn', 'backend', 'bin', 'rg', 'rg-v14.1.0-x86_64-unknown-linux-musl'),
  );
});

test('resolveRgPath: override beats prod dir', async (t) => {
  const home = makeProdHome(t, ['rg-v13.0.0-x86_64-unknown-linux-musl']);
  const dir = await mkdtemp(join(tmpdir(), 'fm-rgpath-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const fake = join(dir, 'my-rg');
  await writeFile(fake, 'fake');
  const { resolveRgPath } = await import('../../src/fm/storages/cold/grep.js');
  assert.equal(resolveRgPath({ env: { CODRYN_RG_PATH: fake }, homeDir: home }), fake);
});
