import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FileRepository,
  IgnoreFilter,
  ListDirService,
  NodeFileSystem,
  SearchFilesService,
} from '../../src/fm/index.js';
import { loadGitignorePatterns, parseGitignoreContent } from '../../apps/shared/gitignore.js';

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'fm-ignore-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('ignore engine: matches dirs (bare + children) and files', () => {
  const filter = new IgnoreFilter(['node_modules/', '.git/', 'dist/', '*.log', '!keep.log']);
  assert.equal(filter.ignores('node_modules', true), true);
  assert.equal(filter.ignores('node_modules/pkg/a.js', false), true);
  assert.equal(filter.ignores('.git', true), true);
  assert.equal(filter.ignores('dist', true), true);
  assert.equal(filter.ignores('dist/bundle.js', false), true);
  assert.equal(filter.ignores('a.log', false), true);
  assert.equal(filter.ignores('keep.log', false), false);
  assert.equal(filter.ignores('src/index.ts', false), false);
  assert.equal(filter.ignores('src', true), false);
});

test('ignore engine: empty patterns ignore nothing', () => {
  const filter = new IgnoreFilter([]);
  assert.equal(filter.ignores('node_modules', true), false);
  assert.equal(filter.ignores('a.txt', false), false);
});

test('listDir: filters .gitignore entries, keeps negated ones', async (t) => {
  const dir = await setup(t);
  await writeFile(join(dir, '.gitignore'), 'dist/\n*.log\n!important.log\n');
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist', 'bundle.js'), 'x');
  await writeFile(join(dir, 'debug.log'), 'x');
  await writeFile(join(dir, 'important.log'), 'x');
  await writeFile(join(dir, 'index.ts'), 'x');

  const repo = new FileRepository(new NodeFileSystem());
  const data = await repo.listDir(dir, dir, {
    ignorePatterns: ['dist/', '*.log', '!important.log'],
  });
  const names = data.nodes.map((n) => n.name).sort();
  assert.deepEqual(names, ['.gitignore', 'important.log', 'index.ts']);
});

test('listDir: defaults still hide node_modules and .git', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'a.js'), 'x');
  await writeFile(join(dir, 'index.ts'), 'x');

  const repo = new FileRepository(new NodeFileSystem());
  const data = await repo.listDir(dir, dir);
  assert.deepEqual(
    data.nodes.map((n) => n.name),
    ['index.ts'],
  );
});

test('searchFiles: prunes ignored trees', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist', 'target.js'), 'x');
  await writeFile(join(dir, 'target.js'), 'x');

  const service = new SearchFilesService(new FileRepository(new NodeFileSystem()), dir, {
    ignorePatterns: ['dist/'],
  });
  const result = await service.searchFiles('', 'target');
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.matches.map((n) => n.path),
    ['target.js'],
  );
});

test('services: includeIgnored bypasses filtering', async (t) => {
  const dir = await setup(t);
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist', 'bundle.js'), 'x');
  await writeFile(join(dir, 'index.ts'), 'x');

  const repo = new FileRepository(new NodeFileSystem());
  const list = new ListDirService(repo, dir, { ignorePatterns: ['dist/'] });
  const filtered = await list.listDir('');
  assert.equal(filtered.success, true);
  if (!filtered.success) return;
  assert.deepEqual(
    filtered.data.nodes.map((n) => n.name),
    ['index.ts'],
  );

  const shown = await list.listDir('', { includeIgnored: true });
  assert.equal(shown.success, true);
  if (!shown.success) return;
  assert.deepEqual(shown.data.nodes.map((n) => n.name).sort(), ['dist', 'index.ts']);
});

test('parseGitignoreContent: drops blanks and comments, dedupes', () => {
  assert.deepEqual(parseGitignoreContent('# comment\n\ndist/\n*.log\ndist/\n'), ['dist/', '*.log']);
});

test('loadGitignorePatterns: reads .gitignore via ReadFileService', async () => {
  const patterns = await loadGitignorePatterns({
    readFile: async (requestedPath: string) => {
      if (requestedPath === '.gitignore') {
        return {
          success: true,
          data: {
            path: '.gitignore',
            content: 'dist/\n',
            encoding: 'utf-8',
            size: 6,
            truncated: false,
          },
        };
      }
      return {
        success: false,
        error: { code: 'PATH_NOT_FOUND', message: 'not found', statusCode: 404 },
      };
    },
  });
  assert.deepEqual(patterns, ['dist/']);
});

test('loadGitignorePatterns: missing .gitignore yields []', async () => {
  const patterns = await loadGitignorePatterns({
    readFile: async () => ({
      success: false,
      error: { code: 'PATH_NOT_FOUND', message: 'not found', statusCode: 404 },
    }),
  });
  assert.deepEqual(patterns, []);
});
