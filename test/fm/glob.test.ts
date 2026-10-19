import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FileType,
  GlobRepository,
  GlobService,
  GlobStorage,
  NodeFileSystem,
  isFmPendingApproval,
} from '../../src/fm/index.js';
import { formatGlob } from '../../apps/agent/tools/format.js';

async function setup(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-glob-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeService(dir: string, ignorePatterns: string[] = []) {
  return new GlobService(
    new GlobRepository(new GlobStorage(), new NodeFileSystem()),
    dir,
    { ignorePatterns },
    new NodeFileSystem(),
  );
}

test('glob: matches nested files, files only, newest first', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'src', 'fm'), { recursive: true });
  await writeFile(join(dir, 'index.ts'), 'x');
  await writeFile(join(dir, 'src', 'fm', 'old.ts'), 'x');
  await writeFile(join(dir, 'src', 'fm', 'new.ts'), 'x');
  await writeFile(join(dir, 'readme.md'), 'x');
  // Distinct mtimes: new.ts newest, then old.ts, then index.ts.
  await utimes(join(dir, 'index.ts'), new Date(1000), new Date(1000));
  await utimes(join(dir, 'src', 'fm', 'old.ts'), new Date(2000), new Date(2000));
  await utimes(join(dir, 'src', 'fm', 'new.ts'), new Date(3000), new Date(3000));

  const service = makeService(dir);
  const result = await service.glob('', { pattern: '**/*.ts' });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.nodes.map((n) => n.path),
    ['src/fm/new.ts', 'src/fm/old.ts', 'index.ts'],
  );
  assert.equal(result.data.truncated, false);
  assert.equal(result.data.pattern, '**/*.ts');
});

test('glob: brace expansion and scoped path', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'x');
  await writeFile(join(dir, 'src', 'b.tsx'), 'x');
  await writeFile(join(dir, 'src', 'c.js'), 'x');

  const service = makeService(dir);
  const result = await service.glob('src', { pattern: '*.{ts,tsx}' });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.nodes.map((n) => n.name).sort(), ['a.ts', 'b.tsx']);
});

test('glob: default ignores hide node_modules; includeIgnored bypasses', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'dep.js'), 'x');
  await writeFile(join(dir, 'app.js'), 'x');

  const service = makeService(dir);
  const filtered = await service.glob('', { pattern: '**/*.js' });
  assert.equal(filtered.success, true);
  if (!filtered.success) return;
  assert.deepEqual(filtered.data.nodes.map((n) => n.name), ['app.js']);

  const shown = await service.glob('', { pattern: '**/*.js', includeIgnored: true });
  assert.equal(shown.success, true);
  if (!shown.success) return;
  assert.deepEqual(shown.data.nodes.map((n) => n.name).sort(), ['app.js', 'dep.js']);
});

test('glob: workspace ignorePatterns applied', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist', 'bundle.js'), 'x');
  await writeFile(join(dir, 'app.js'), 'x');

  const service = makeService(dir, ['dist/']);
  const result = await service.glob('', { pattern: '**/*.js' });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.nodes.map((n) => n.name), ['app.js']);
});

test('glob: caps results and flags truncation', async (t) => {
  const dir = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'x');
  await writeFile(join(dir, 'b.ts'), 'x');
  await writeFile(join(dir, 'c.ts'), 'x');

  const service = makeService(dir);
  const result = await service.glob('', { pattern: '**/*.ts', maxResults: 2 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.nodes.length, 2);
  assert.equal(result.data.truncated, true);
});

test('glob: outside root needs approval, confirm searches it', async (t) => {
  const dir = await setup(t);
  const outside = await setup(t);
  await writeFile(join(outside, 'secret.ts'), 'x');

  const service = makeService(dir);
  const result = await service.glob(outside, { pattern: '**/*.ts' });
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.equal(result.permission.operation, 'glob');

  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
  if (!after.success) return;
  assert.ok(after.data.nodes.some((n) => n.name === 'secret.ts'));
});

test('formatGlob: header, paths, truncation marker', () => {
  const nodes = [
    {
      id: '1',
      name: 'a.ts',
      path: 'src/a.ts',
      type: FileType.FILE,
      isDirectory: false,
      lastModified: 3000,
    },
    {
      id: '2',
      name: 'b.ts',
      path: 'src/b.ts',
      type: FileType.FILE,
      isDirectory: false,
      lastModified: 2000,
    },
  ];
  const out = formatGlob('**/*.ts', '/', nodes);
  assert.match(out, /Found 2 files matching "\*\*\/\*\.ts"/);
  assert.match(out, /- `src\/a\.ts`/);
  assert.match(out, /- `src\/b\.ts`/);

  const empty = formatGlob('**/*.rs', '/', []);
  assert.match(empty, /No files match/);
});
