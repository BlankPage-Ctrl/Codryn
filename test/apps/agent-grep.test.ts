import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GrepRepository, GrepService, GrepStorage } from '../../src/fm/index.js';
import { createGrepTool } from '../../apps/agent/tools/grep.js';

function requireText(out: unknown): string {
  if (typeof out !== 'string') throw new Error(`expected tool text output, got ${typeof out}`);
  return out;
}

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-grep-'));
  const service = new GrepService(new GrepRepository(new GrepStorage()), dir);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('grep tool: returns markdown with path, line, and code', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'app.ts'), 'const a = 1;\nconst needle = 2;\n');

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  assert.equal(tool.name, 'grep');
  const out = requireText(await tool.execute({ pattern: 'needle', path: '.' }));
  assert.ok(out.includes('# grep "needle" — 1 match'));
  assert.ok(out.includes('## `app.ts`'));
  assert.ok(out.includes('- L2:C7: `const needle = 2;`'));
});

test('grep tool: path scoping and literal mode pass through', async (t) => {
  const { dir, service } = await setup(t);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'foo(bar\n');
  await writeFile(join(dir, 'b.ts'), 'foo(bar\n');

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  const out = requireText(await tool.execute({ pattern: 'foo(bar', path: 'src', regex: false }));
  assert.ok(out.includes('## `src/a.ts`'));
  assert.ok(!out.includes('b.ts'));
});

test('grep tool: output_mode files_with_matches lists files without match lines', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'app.ts'), 'const needle = 1;\nconst needle2 = 2;\n');

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  const out = requireText(
    await tool.execute({ pattern: 'needle', path: '.', output_mode: 'files_with_matches' }),
  );
  assert.ok(out.includes('`app.ts`'));
  assert.ok(!out.includes('L1:C'));
});

test('grep tool: output_mode count shows per-file totals', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'app.ts'), 'const needle = 1;\nconst needle2 = 2;\n');

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  const out = requireText(
    await tool.execute({ pattern: 'needle', path: '.', output_mode: 'count' }),
  );
  assert.ok(out.includes('occurrences across'));
  assert.ok(out.includes('`app.ts`: 2'));
});

test('grep tool: invalid regex returns suggestion text, not a throw', async (t) => {
  const { dir, service } = await setup(t);
  await writeFile(join(dir, 'a.ts'), 'x\n');

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  const out = requireText(await tool.execute({ pattern: '([', path: '.' }));
  assert.ok(out.includes('`INVALID_INPUT`'));
  assert.ok(out.includes('`regex: false`'));
});

test('grep tool: huge output is truncated with a spill file', async (t) => {
  const { dir, service } = await setup(t);
  const lines = Array.from(
    { length: 300 },
    (_, i) => `needle padded line number ${i} with extra filler text to grow chars`,
  ).join('\n');
  await writeFile(join(dir, 'big.ts'), `${lines}\n`);

  const [tool] = createGrepTool(service, { projectPath: dir });
  assert.ok(tool);
  const out = requireText(await tool.execute({ pattern: 'needle', path: '.', maxResults: 200 }));
  assert.ok(out.includes('<truncate>'), 'expected truncate notice');
  const spill = out.match(/`(\.codryn\/truncated\/grep-[^`]+)`/);
  assert.ok(spill, 'expected spill path in notice');
  await access(join(dir, spill[1] as string));
});
