import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EditFileService, FileRepository, NodeFileSystem } from '../../src/fm/index.js';
import type { OnRichResult } from '../../apps/agent/tools/rich-result.js';
import { createEditTool } from '../../apps/agent/tools/edit.js';
import { formatEditFailure } from '../../apps/agent/tools/format.js';

function requireText(out: unknown): string {
  if (typeof out !== 'string') throw new Error(`expected tool text output, got ${typeof out}`);
  return out;
}

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-edit-'));
  const repo = new FileRepository(new NodeFileSystem());
  const editService = new EditFileService(repo, dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, editService };
}

test('edit_file: success returns header plus unified diff', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive');
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    { raw: 'a.txt\n<<<<<<< SEARCH lines 2\ntwo\n=======\nTWO\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-1' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('# `a.txt` — 1 edit applied'));
  assert.ok(out.includes('```diff'));
  assert.ok(out.includes('-two'));
  assert.ok(out.includes('+TWO'));
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf-8'), 'one\nTWO\nthree\nfour\nfive');
});

test('edit_file: emits rich result via onRichResult on success', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'b.txt'), 'hello');
  const seen: Parameters<OnRichResult>[0][] = [];
  const [tool] = createEditTool(editService, { onRichResult: (rich) => seen.push(rich) });
  assert.ok(tool);
  await tool.execute(
    { raw: 'b.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-2' },
  );
  assert.equal(seen.length, 1);
  const rich = seen[0];
  assert.ok(rich);
  assert.equal(rich.toolCallId, 'call-2');
  assert.equal(rich.implement, 'edit_file');
  const body: unknown = rich.body;
  if (typeof body !== 'object' || body === null || !('path' in body) || !('diff' in body)) {
    throw new Error('expected edit_file rich body with path and diff');
  }
  assert.equal(body.path, 'b.txt');
  assert.ok(typeof body.diff === 'string' && body.diff.includes('+hi'));
});

test('edit_file: malformed raw returns VALIDATION_FAILED text instead of throwing', async (t) => {
  const { editService } = await setup(t);
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute({ raw: 'a.txt\nno blocks here\n' }, { toolCallId: 'call-3' });
  const out = requireText(rawOut);
  assert.ok(out.includes('**Error**: `VALIDATION_FAILED`'));
  assert.ok(out.includes('**Suggestion**'));
});

test('edit_file: NOT_FOUND tells the model to re-read', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'c.txt'), 'alpha\nbeta');
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    { raw: 'c.txt\n<<<<<<< SEARCH\ngamma\n=======\ndelta\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-4' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('**Error**: `EDIT_FAILED`'));
  assert.ok(out.includes('stale'));
  assert.ok(out.includes('read_file'));
});

test('edit_file: AMBIGUOUS lists matches and suggests a lines hint', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'd.txt'), 'x = 1\ny = 2\nx = 1');
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    { raw: 'd.txt\n<<<<<<< SEARCH\nx = 1\n=======\nx = 9\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-5' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('matches 2 locations'));
  assert.ok(out.includes('line 1'));
  assert.ok(out.includes('line 3'));
  assert.ok(out.includes('`lines <start>[-<end>]`'));
});

test('edit_file: NOT_FOUND_IN_HINT points at actual locations', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(
    join(dir, 'e.txt'),
    ['apple', ...Array.from({ length: 9 }, (_, i) => `row${i + 2}`)].join('\n'),
  );
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    { raw: 'e.txt\n<<<<<<< SEARCH lines 10\napple\n=======\nAPPLE\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-6' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('not within'));
  assert.ok(out.includes('line 1'));
});

test('edit_file: OVERLAP suggests merging or splitting', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'f.txt'), 'one\ntwo\nthree');
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    {
      raw: 'f.txt\n<<<<<<< SEARCH\none\ntwo\n=======\nONE\n>>>>>>> REPLACE\n<<<<<<< SEARCH\ntwo\nthree\n=======\nTWO\n>>>>>>> REPLACE\n',
    },
    { toolCallId: 'call-7' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('overlaps'));
  assert.ok(out.includes('separate edit_file calls'));
});

test('edit_file: missing file suggests list_files', async (t) => {
  const { editService } = await setup(t);
  const [tool] = createEditTool(editService);
  assert.ok(tool);
  const rawOut = await tool.execute(
    { raw: 'nope.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
    { toolCallId: 'call-8' },
  );
  const out = requireText(rawOut);
  assert.ok(out.includes('**Error**: `PATH_NOT_FOUND`'));
  assert.ok(out.includes('**Path**: `nope.txt`'));
  assert.ok(out.includes('list_files'));
});

test('formatEditFailure: unknown details fall back to generic suggestion', () => {
  const out = formatEditFailure('EDIT_FAILED', 'boom', { weird: true }, 'g.txt');
  assert.ok(out.includes('**Error**: `EDIT_FAILED` — boom'));
  assert.ok(out.includes('**Path**: `g.txt`'));
  assert.ok(out.includes('**Suggestion**'));
});
