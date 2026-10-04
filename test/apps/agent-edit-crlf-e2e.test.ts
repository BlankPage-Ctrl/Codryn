import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EditFileService, FileRepository, NodeFileSystem } from '../../src/fm/index.js';
import { createEditTool } from '../../apps/agent/tools/edit.js';

// Replay of the real run-1 failure from data.db (msg-WvIY… pos 48/49):
// the on-disk scaffold was CRLF (NestJS on Windows) while the model's
// SEARCH block was LF. The old exact-match engine returned NOT_FOUND;
// the tool must now succeed and preserve CRLF on disk.
const CRLF_MAIN = [
  "import { NestFactory } from '@nestjs/core';",
  "import { AppModule } from './app.module.js';",
  '',
  'async function bootstrap() {',
  '  const app = await NestFactory.create(AppModule);',
  '  await app.listen(process.env.PORT ?? 3000);',
  '}',
  'await bootstrap();',
].join('\r\n');

const LF_SEARCH = [
  "import { NestFactory } from '@nestjs/core';",
  "import { AppModule } from './app.module.js';",
  '',
  'async function bootstrap() {',
  '  const app = await NestFactory.create(AppModule);',
  '  await app.listen(process.env.PORT ?? 3000);',
  '}',
  'await bootstrap();',
].join('\n');

const LF_REPLACE = [
  "import { NestFactory } from '@nestjs/core';",
  "import { ValidationPipe } from '@nestjs/common';",
  "import { AppModule } from './app.module.js';",
  '',
  'async function bootstrap() {',
  '  const app = await NestFactory.create(AppModule);',
  '  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));',
  '  await app.listen(process.env.PORT ?? 3000);',
  '}',
  'await bootstrap();',
].join('\n');

async function setup(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-edit-crlf-'));
  const repo = new FileRepository(new NodeFileSystem());
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, editService: new EditFileService(repo, dir) };
}

test('edit_file e2e: LF SEARCH block edits a CRLF file and preserves CRLF', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'main.ts'), CRLF_MAIN);
  const [tool] = createEditTool(editService);
  assert.ok(tool);

  const rawOut = await tool.execute(
    { raw: `main.ts\n<<<<<<< SEARCH\n${LF_SEARCH}\n=======\n${LF_REPLACE}\n>>>>>>> REPLACE\n` },
    { toolCallId: 'call-crlf-1' },
  );
  assert.equal(typeof rawOut, 'string');
  assert.ok(rawOut.includes('1 edit applied'), `expected success, got:\n${rawOut}`);
  assert.ok(!rawOut.includes('**Error**'));

  const onDisk = await readFile(join(dir, 'main.ts'), 'utf-8');
  assert.ok(onDisk.includes('\r\n'), 'CRLF style must survive the edit');
  assert.ok(!/[^\r]\n/.test(onDisk.replace(/\r\n/g, '')), 'no stray LF-only endings');
  assert.ok(onDisk.includes('ValidationPipe({ whitelist: true })'));
});

test('edit_file e2e: same edit with a lines hint also succeeds on CRLF', async (t) => {
  const { dir, editService } = await setup(t);
  await writeFile(join(dir, 'main.ts'), CRLF_MAIN);
  const [tool] = createEditTool(editService);
  assert.ok(tool);

  const rawOut = await tool.execute(
    {
      raw: `main.ts\n<<<<<<< SEARCH lines 1-8\n${LF_SEARCH}\n=======\n${LF_REPLACE}\n>>>>>>> REPLACE\n`,
    },
    { toolCallId: 'call-crlf-2' },
  );
  assert.equal(typeof rawOut, 'string');
  assert.ok(rawOut.includes('1 edit applied'), `expected success, got:\n${rawOut}`);

  const onDisk = await readFile(join(dir, 'main.ts'), 'utf-8');
  assert.ok(onDisk.includes('ValidationPipe'));
  assert.ok(onDisk.includes('\r\n'));
});
