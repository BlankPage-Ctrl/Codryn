import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FileRepository,
  NodeFileSystem,
  ReadFileService,
  ListDirService,
  GetStatService,
  SearchFilesService,
  EditFileService,
  CreateFileService,
  GrepService,
  GrepRepository,
  GrepStorage,
  classifyWorkspacePath,
  isFmPendingApproval,
} from '../../src/fm/index.js';
import {
  addFmAlwaysAllowed,
  clearFmAlwaysAllowed,
  fmAlwaysKey,
  isFmAlwaysAllowed,
} from '../../apps/shared/fm-always-allow.js';

interface Ctx {
  ws: string;
  outside: string;
  readFile: ReadFileService;
  listDir: ListDirService;
  stat: GetStatService;
  search: SearchFilesService;
  edit: EditFileService;
  createFile: CreateFileService;
  grep: GrepService;
}

async function setup(t: { after: (fn: () => unknown) => void }): Promise<Ctx> {
  const ws = await mkdtemp(join(tmpdir(), 'fm-ws-'));
  const outside = await mkdtemp(join(tmpdir(), 'fm-outside-'));
  const repo = new FileRepository(new NodeFileSystem());
  t.after(async () => {
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  return {
    ws,
    outside,
    readFile: new ReadFileService(repo, ws),
    listDir: new ListDirService(repo, ws),
    stat: new GetStatService(repo, ws),
    search: new SearchFilesService(repo, ws),
    edit: new EditFileService(repo, ws),
    createFile: new CreateFileService(repo, ws),
    grep: new GrepService(new GrepRepository(new GrepStorage()), ws, {}, new NodeFileSystem()),
  };
}

test('classify: ./src/x inside, /tmp/codryn outside, ../escape outside', async (t) => {
  const { ws, outside } = await setup(t);
  assert.equal(classifyWorkspacePath(ws, './src/x').inside, true);
  assert.equal(classifyWorkspacePath(ws, '.').inside, true);
  assert.equal(classifyWorkspacePath(ws, outside).inside, false);
  assert.equal(classifyWorkspacePath(ws, '../escape').inside, false);
  assert.equal(classifyWorkspacePath(ws, '/etc/passwd').inside, false);
});

test('read: inside file succeeds directly (no pending)', async (t) => {
  const { ws, readFile } = await setup(t);
  await writeFile(join(ws, 'a.txt'), 'hello');
  const result = await readFile.readFile('a.txt', { withLineNumbers: false });
  assert.equal(isFmPendingApproval(result), false);
  assert.equal(result.success, true);
});

test('read: outside nonexistent path returns pending WITHOUT fs access', async (t) => {
  const { outside, readFile } = await setup(t);
  // join() with an absolute segment yields an absolute outside path.
  const result = await readFile.readFile(join(outside, 'nope.txt'));
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.equal(result.error.code, 'REQUIRES_APPROVAL');
  // Approving runs the op, which then reports the real fs error.
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, false);
  if (after.success) return;
  assert.equal(after.error.code, 'PATH_NOT_FOUND');
});

test('read: outside real file pending → confirm allow reads content', async (t) => {
  const { outside, readFile } = await setup(t);
  await writeFile(join(outside, 'secret.txt'), 'outside-content');
  const result = await readFile.readFile(join(outside, 'secret.txt'));
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.equal(result.permission.operation, 'read');
  assert.equal(result.permission.viaSymlink, false);
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
  if (!after.success) return;
  assert.match(after.data.content, /outside-content/);
});

test('read: pending abort/deny yields PERMISSION_DENIED', async (t) => {
  const { outside, readFile } = await setup(t);
  await writeFile(join(outside, 's.txt'), 'x');
  const denied = await readFile.readFile(join(outside, 's.txt'));
  assert.equal(isFmPendingApproval(denied), true);
  if (!isFmPendingApproval(denied)) return;
  const d = await denied.confirm({ decision: 'deny' });
  assert.equal(d.success, false);
  if (d.success) return;
  assert.equal(d.error.code, 'PERMISSION_DENIED');

  const pending2 = await readFile.readFile(join(outside, 's.txt'));
  assert.equal(isFmPendingApproval(pending2), true);
  if (!isFmPendingApproval(pending2)) return;
  const a = await pending2.abort();
  assert.equal(a.success, false);
  assert.equal(a.error.code, 'PERMISSION_DENIED');
});

test('read: symlink inside → outside counts as outside (viaSymlink)', async (t) => {
  const { ws, outside, readFile } = await setup(t);
  await writeFile(join(outside, 'real.txt'), 'linked');
  await symlink(join(outside, 'real.txt'), join(ws, 'link.txt'));
  const result = await readFile.readFile('link.txt');
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.equal(result.permission.viaSymlink, true);
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
});

test('list: ancestor dir symlink to outside counts as outside', async (t) => {
  const { ws, outside, listDir } = await setup(t);
  await writeFile(join(outside, 'f.txt'), 'x');
  await symlink(outside, join(ws, 'ext'));
  const result = await listDir.listDir('ext');
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.equal(result.permission.viaSymlink, true);
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
  if (!after.success) return;
  assert.ok(after.data.nodes.some((n) => n.name === 'f.txt'));
});

test('list: outside dir pending → confirm lists entries', async (t) => {
  const { outside, listDir } = await setup(t);
  await writeFile(join(outside, 'g.txt'), 'x');
  const result = await listDir.listDir(outside);
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
  if (!after.success) return;
  assert.ok(after.data.nodes.some((n) => n.name === 'g.txt'));
});

test('stat + search: outside paths need approval', async (t) => {
  const { outside, stat, search } = await setup(t);
  await writeFile(join(outside, 'needle-file.txt'), 'x');
  const s = await stat.getStat(join(outside, 'needle-file.txt'));
  assert.equal(isFmPendingApproval(s), true);
  if (!isFmPendingApproval(s)) return;
  const sAfter = await s.confirm({ decision: 'allow' });
  assert.equal(sAfter.success, true);

  const q = await search.searchFiles(outside, 'needle');
  assert.equal(isFmPendingApproval(q), true);
  if (!isFmPendingApproval(q)) return;
  const qAfter = await q.confirm({ decision: 'allow' });
  assert.equal(qAfter.success, true);
  if (!qAfter.success) return;
  assert.ok(qAfter.data.matches.some((m) => m.path.includes('needle-file.txt')));
});

test('grep: outside root pending → confirm searches it', async (t) => {
  const { outside, grep } = await setup(t);
  await writeFile(join(outside, 'code.ts'), 'const needleGreppable = 1;\n');
  const result = await grep.grep(outside, 'needleGreppable');
  assert.equal(isFmPendingApproval(result), true);
  if (!isFmPendingApproval(result)) return;
  assert.deepEqual(result.permission.outsidePaths, [result.permission.absolutePath]);
  const after = await result.confirm({ decision: 'allow' });
  assert.equal(after.success, true);
  if (!after.success) return;
  assert.equal(after.data.matches.length, 1);
});

test('write: edit + create outside are hard-denied (no pending)', async (t) => {
  const { outside, edit, createFile } = await setup(t);
  const target = join(outside, 'w.txt');
  await writeFile(target, 'base\n');
  const e = await edit.editFile({
    path: target,
    edits: [{ search: 'base', replace: 'changed' }],
    apply_order: 'forward',
  });
  assert.equal(e.success, false);
  assert.equal(isFmPendingApproval(e), false);
  if (e.success) return;
  assert.equal(e.error.code, 'PATH_TRAVERSAL');

  const c = await createFile.createFile({
    path: join(outside, 'new.txt'),
    content: 'x',
    overwrite: false,
  });
  assert.equal(c.success, false);
  assert.equal(isFmPendingApproval(c), false);
  if (c.success) return;
  assert.equal(c.error.code, 'PATH_TRAVERSAL');
});

test('always-allow RAM store: directory-prefix, per-chat key', () => {
  const key = fmAlwaysKey('ws1', 'chat1')!;
  const other = fmAlwaysKey('ws1', 'chat2')!;
  clearFmAlwaysAllowed(key);
  clearFmAlwaysAllowed(other);
  assert.equal(isFmAlwaysAllowed(key, '/tmp/codryn/a/b.md'), false);
  // Approving a directory covers its subtree (prefix semantics).
  addFmAlwaysAllowed(key, '/tmp/codryn');
  assert.equal(isFmAlwaysAllowed(key, '/tmp/codryn/a/b.md'), true);
  assert.equal(isFmAlwaysAllowed(key, '/tmp/codryn'), true);
  assert.equal(isFmAlwaysAllowed(key, '/tmp/other/x.md'), false);
  // Scoped to workspaceId:chatId - another chat is unaffected.
  assert.equal(isFmAlwaysAllowed(other, '/tmp/codryn/a/b.md'), false);
  // Approving a file covers (exactly) that file.
  addFmAlwaysAllowed(other, '/tmp/codryn/note.md');
  assert.equal(isFmAlwaysAllowed(other, '/tmp/codryn/note.md'), true);
  assert.equal(isFmAlwaysAllowed(other, '/tmp/codryn/other.md'), false);
  // Null key (missing ids) never matches and never stores.
  assert.equal(isFmAlwaysAllowed(null, '/tmp/codryn/a'), false);
  assert.equal(addFmAlwaysAllowed(null, '/tmp/codryn/a'), false);
  clearFmAlwaysAllowed(key);
  clearFmAlwaysAllowed(other);
});
