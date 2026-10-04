import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileRepository, NodeFileSystem, ReadFileService } from '../../src/fm/index.js';
import {
  MAX_READFILE_LIMIT,
  createReadFileTool,
  readFileSchema,
} from '../../apps/agent/tools/readfile.js';

function requireText(out: unknown): string {
  if (typeof out !== 'string') throw new Error(`expected tool text output, got ${typeof out}`);
  return out;
}

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-readfile-'));
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  await writeFile(join(dir, 'a.txt'), `${lines.join('\n')}\n`);
  const service = new ReadFileService(new FileRepository(new NodeFileSystem()), dir);
  const [tool] = createReadFileTool(service, { projectPath: dir });
  assert.ok(tool);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service, tool };
}

function freshTool(
  service: ReadFileService,
  dir: string,
): ReturnType<typeof createReadFileTool>[number] {
  const [tool] = createReadFileTool(service, { projectPath: dir });
  assert.ok(tool);
  return tool;
}

test('read_file: offset/limit reads the same window as startLine/endLine', async (t) => {
  const { dir, service } = await setup(t);
  // Separate tool instances: the per-run subset guard would refuse the
  // second identical window on a shared instance.
  const viaOffset = requireText(
    await freshTool(service, dir).execute({ path: 'a.txt', offset: 5, limit: 3 }),
  );
  const viaRange = requireText(
    await freshTool(service, dir).execute({ path: 'a.txt', startLine: 5, endLine: 7 }),
  );
  assert.ok(viaOffset.includes('lines 5–7 of 20'));
  for (const n of [5, 6, 7]) {
    assert.ok(viaOffset.includes(`line${n}`), `expected line${n} in offset output`);
  }
  assert.equal(viaOffset, viaRange);
});

test('read_file: offset=1 reads from the first line', async (t) => {
  const { tool } = await setup(t);
  const out = requireText(await tool.execute({ path: 'a.txt', offset: 1, limit: 2 }));
  assert.ok(out.includes('lines 1–2 of 20'));
  assert.ok(out.includes('line1'));
  assert.ok(out.includes('line2'));
  assert.ok(!out.includes('line3'));
});

test('read_file: limit without offset reads from the first line', async (t) => {
  const { tool } = await setup(t);
  const out = requireText(await tool.execute({ path: 'a.txt', limit: 2 }));
  assert.ok(out.includes('lines 1–2 of 20'));
  assert.ok(out.includes('line1'));
  assert.ok(out.includes('line2'));
  assert.ok(!out.includes('line3'));
});

test('read_file: legacy startLine/endLine still works without offset/limit', async (t) => {
  const { tool } = await setup(t);
  const out = requireText(await tool.execute({ path: 'a.txt', startLine: 19, endLine: 20 }));
  assert.ok(out.includes('lines 19–20 of 20'));
  assert.ok(out.includes('line19'));
  assert.ok(out.includes('line20'));
});

test('read_file: schema rejects limit+endLine and offset+startLine together', () => {
  const both = readFileSchema.safeParse({ path: 'a.txt', limit: 10, endLine: 20 });
  assert.equal(both.success, false);
  if (!both.success) {
    assert.ok(both.error.issues.some((i) => i.path.join('.') === 'limit'));
  }
  const bothStart = readFileSchema.safeParse({ path: 'a.txt', offset: 5, startLine: 6 });
  assert.equal(bothStart.success, false);
  if (!bothStart.success) {
    assert.ok(bothStart.error.issues.some((i) => i.path.join('.') === 'offset'));
  }
});

test('read_file: schema rejects limit above the cap', () => {
  const over = readFileSchema.safeParse({
    path: 'a.txt',
    offset: 1,
    limit: MAX_READFILE_LIMIT + 1,
  });
  assert.equal(over.success, false);
});

test('read_file: schema rejects offset=0 (1-indexed)', () => {
  const zero = readFileSchema.safeParse({ path: 'a.txt', offset: 0, limit: 10 });
  assert.equal(zero.success, false);
});

test('read_file: re-reading a covered window is refused on the same instance', async (t) => {
  const { tool } = await setup(t);
  const first = requireText(await tool.execute({ path: 'a.txt', startLine: 1, endLine: 20 }));
  assert.ok(first.includes('lines 1–20 of 20'));
  const second = requireText(await tool.execute({ path: 'a.txt', startLine: 5, endLine: 7 }));
  assert.ok(second.includes('ALREADY_READ'));
});

test('read_file: continuation past the read window is allowed', async (t) => {
  const { tool } = await setup(t);
  const first = requireText(await tool.execute({ path: 'a.txt', startLine: 1, endLine: 10 }));
  assert.ok(first.includes('lines 1–10 of 20'));
  const second = requireText(await tool.execute({ path: 'a.txt', startLine: 11, endLine: 20 }));
  assert.ok(second.includes('lines 11–20 of 20'));
});

test('read_file: spill paths are refused without touching the filesystem', async (t) => {
  const { tool } = await setup(t);
  const out = requireText(
    await tool.execute({ path: '.codryn/truncated/grep-abcde.txt', startLine: 1, endLine: 50 }),
  );
  assert.ok(out.includes('SPILL_FILE'));
});
