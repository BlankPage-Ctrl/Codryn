import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  NodeFileSystem,
  NodeFileWatcher,
  WatchEventType,
  type WatchEvent,
} from '../../src/fm/index.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  events: WatchEvent[],
  predicate: (event: WatchEvent) => boolean,
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (events.some(predicate)) return;
    await sleep(50);
  }
  assert.fail('timed out waiting for watch event');
}

async function makeWatcher(dir: string) {
  const events: WatchEvent[] = [];
  const watcher = new NodeFileWatcher(new NodeFileSystem(), dir);
  watcher.setOnEvent((event) => events.push(event));
  await watcher.start();
  await sleep(300);
  return { watcher, events };
}

async function setup(t: { after: (fn: () => void) => void }, name: string) {
  const dir = await mkdtemp(join(tmpdir(), `fm-watch-${name}-`));
  const { watcher, events } = await makeWatcher(dir);
  t.after(async () => {
    await watcher.stop();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, events };
}

test('watcher: emits CREATED for a new file', async (t) => {
  const { dir, events } = await setup(t, 'create');

  await writeFile(join(dir, 'a.txt'), 'hello');
  await waitFor(events, (e) => e.type === WatchEventType.CREATED && e.node.path === 'a.txt');
});

test('watcher: emits MODIFIED on file update', async (t) => {
  const { dir, events } = await setup(t, 'modify');

  await writeFile(join(dir, 'a.txt'), 'hello');
  await waitFor(events, (e) => e.node.path === 'a.txt');
  await sleep(200);
  await writeFile(join(dir, 'a.txt'), 'hello world');
  await waitFor(events, (e) => e.type === WatchEventType.MODIFIED && e.node.path === 'a.txt');
});

test('watcher: emits DELETED when a file is removed', async (t) => {
  const { dir, events } = await setup(t, 'delete');

  await writeFile(join(dir, 'a.txt'), 'hello');
  await waitFor(events, (e) => e.node.path === 'a.txt');
  await sleep(200);
  await rm(join(dir, 'a.txt'));
  await waitFor(events, (e) => e.type === WatchEventType.DELETED && e.node.path === 'a.txt');
});

test('watcher: emits MOVED with oldPath on a file rename', async (t) => {
  const { dir, events } = await setup(t, 'move');

  await writeFile(join(dir, 'a.txt'), 'hello');
  await waitFor(events, (e) => e.node.path === 'a.txt');
  await sleep(200);
  await rename(join(dir, 'a.txt'), join(dir, 'b.md'));
  await waitFor(events, (e) => e.type === WatchEventType.MOVED && e.node.path === 'b.md');
  const moved = events.find((e) => e.type === WatchEventType.MOVED && e.node.path === 'b.md');
  assert.equal(moved?.oldPath, 'a.txt');
});

test('watcher: emits CREATED for a directory and marks hasChildren', async (t) => {
  const { dir, events } = await setup(t, 'dir');

  await mkdir(join(dir, 'sub'));
  await waitFor(
    events,
    (e) => e.type === WatchEventType.CREATED && e.node.path === 'sub' && e.node.isDirectory,
  );
  await writeFile(join(dir, 'sub', 'x.ts'), 'x');
  await waitFor(events, (e) => e.node.path === 'sub/x.ts');
});

test('watcher: ignores node_modules and .git trees', async (t) => {
  const { dir, events } = await setup(t, 'ignore');

  await mkdir(join(dir, 'node_modules'));
  await writeFile(join(dir, 'node_modules', 'ignored.txt'), 'x');
  await mkdir(join(dir, '.git'));
  await writeFile(join(dir, '.git', 'config'), 'x');

  await sleep(500);

  const leaked = events.filter(
    (e) => e.node.path.includes('node_modules') || e.node.path.includes('.git'),
  );
  assert.deepEqual(leaked, []);
});
