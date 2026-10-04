import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FileRepository,
  NodeFileSystem,
  SearchFilesService,
  type SearchFilesData,
} from '../../src/fm/index.js';

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-search-'));
  const service = new SearchFilesService(new FileRepository(new NodeFileSystem()), dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('search: matches filename case-insensitively across nested dirs', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'src', 'components'), { recursive: true });
  await writeFile(join(dir, 'src', 'components', 'DropdownMenu.vue'), 'x');
  await writeFile(join(dir, 'src', 'App.vue'), 'x');
  await writeFile(join(dir, 'README.md'), 'x');

  const result = await service.searchFiles('', 'dropdown');
  assert.equal(result.success, true);
  if (!result.success) return;
  const matches = result.data.matches.map((n) => n.path);
  assert.deepEqual(matches, ['src/components/DropdownMenu.vue']);
});

test('search: matches on relative path segments', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'src', 'fixtures'), { recursive: true });
  await writeFile(join(dir, 'src', 'fixtures', 'data.json'), 'x');
  await writeFile(join(dir, 'fixtures.txt'), 'x');

  const result = await service.searchFiles('', 'src/fi');
  assert.equal(result.success, true);
  if (!result.success) return;
  const matches = result.data.matches.map((n) => n.path);
  assert.ok(matches.includes('src/fixtures/data.json'));
});

test('search: ignores node_modules and .git trees', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'query.js'), 'x');
  await writeFile(join(dir, '.git', 'query.js'), 'x');
  await writeFile(join(dir, 'query.js'), 'x');

  const result = await service.searchFiles('', 'query');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((n) => n.path),
    ['query.js'],
  );
});

test('search: returns directories as matches too', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs', 'readme.md'), 'x');

  const result = await service.searchFiles('', 'docs');
  assert.equal(result.success, true);
  if (!result.success) return;
  const paths = result.data.matches.map((n) => n.path);
  assert.ok(paths.includes('docs'));
});

test('search: truncates at maxResults', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'a'), { recursive: true });
  for (let i = 0; i < 10; i++) {
    await writeFile(join(dir, 'a', `match-${i}.txt`), 'x');
  }

  const result = await service.searchFiles('', 'match', { maxResults: 3 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.matches.length, 3);
});

test('search: empty query returns no matches', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'anything.ts'), 'x');

  const result = await service.searchFiles('', '   ');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.matches, []);
});

test('search: does not recurse through symlinked directories', async (t) => {
  const { dir, service } = await setup(t);
  const outside = await mkdtemp(join(tmpdir(), 'fm-search-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(join(outside, 'leak.txt'), 'x');
  await symlink(outside, join(dir, 'link'));

  const result = await service.searchFiles('', 'leak');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((n) => n.path),
    [],
  );
});

test('search: returns FmError for a missing start path', async (t) => {
  const { service } = await setup(t);
  const result = await service.searchFiles('missing-dir', 'anything');
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'PATH_NOT_FOUND');
  }
});

test('search: data shape is SearchFilesData (query + matches)', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'alpha.ts'), 'x');

  const result = await service.searchFiles('', 'alpha');
  assert.equal(result.success, true);
  if (!result.success) return;
  const data: SearchFilesData = result.data;
  assert.equal(data.query, 'alpha');
  assert.equal(data.matches[0]?.name, 'alpha.ts');
});
