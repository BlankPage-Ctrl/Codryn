import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  defaultGlobalShellConfig,
  ShellExecEventBus,
  ShellExecutor,
  ShellRepository,
  ShellService,
  type TerminalPolicy,
} from '../../src/shell/index.js';
import type { ShellExecKilledPayload } from '../../src/shell/types/shell-events.js';

const ALLOW_POLICY: TerminalPolicy = { mode: 'allow', allow: [], ask: [], deny: [] };

// Long-running on every platform. `node -e` is hard-denied, so use the
// platform sleep instead.
const SLEEP_COMMAND = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';

function makeService(bus?: ShellExecEventBus) {
  return new ShellService(
    new ShellRepository(new ShellExecutor()),
    defaultGlobalShellConfig({ defaultTimeoutMs: 60_000 }),
    bus,
  );
}

async function tempRoot(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'shell-kill-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Poll killRun until the subprocess has spawned (covers spawn latency). */
async function killWhenLive(svc: ShellService, executionId: string): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (svc.killRun(executionId).killed) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('kill: running process is SIGKILLed and run resolves with signal', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const executionId = randomUUID();

  const pending = svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId },
    { workspaceId: 'ws-1', chatId: 'chat-1' },
  );

  assert.equal(await killWhenLive(svc, executionId), true);

  const outcome = await pending;
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.executionId, executionId);
  assert.equal(outcome.data.signal, 'SIGKILL');

  // Registry entry is gone: second kill is a no-op, not an error.
  assert.deepEqual(svc.killRun(executionId), { executionId, killed: false });
});

test('kill: unknown execution id returns killed false', async () => {
  const svc = makeService();
  assert.deepEqual(svc.killRun('does-not-exist'), {
    executionId: 'does-not-exist',
    killed: false,
  });
  assert.deepEqual(svc.killAllRuns(), { killedCount: 0 });
});

test('kill: killAllRuns terminates every live run', async (t) => {
  const root = await tempRoot(t);
  const bus = new ShellExecEventBus();
  const svc = makeService(bus);
  const ids = [randomUUID(), randomUUID()];

  const started = new Set<string>();
  bus.on('start', (payload) => {
    started.add(payload.executionId);
  });

  const pendings = ids.map((executionId) =>
    svc.run({ command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId }),
  );

  // Wait until both subprocesses spawned (spawn+track run synchronously
  // after `start`, so anything observed after this point is killable).
  const deadline = Date.now() + 10_000;
  while (started.size < ids.length && Date.now() <= deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(started.size, ids.length);

  assert.deepEqual(svc.killAllRuns(), { killedCount: 2 });

  const outcomes = await Promise.all(pendings);
  for (const outcome of outcomes) {
    assert.equal(outcome.ok, true);
    if (!outcome.ok) continue;
    assert.equal(outcome.data.signal, 'SIGKILL');
  }
  assert.deepEqual(svc.killAllRuns(), { killedCount: 0 });
});

test('kill: killed event is emitted with routing identity', async (t) => {
  const root = await tempRoot(t);
  const bus = new ShellExecEventBus();
  const svc = makeService(bus);
  const executionId = randomUUID();

  const killed: ShellExecKilledPayload[] = [];
  bus.on('killed', (payload) => {
    killed.push(payload);
  });

  const pending = svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId },
    { workspaceId: 'ws-kill', chatId: 'chat-kill', toolCallId: 'tool-1' },
  );

  assert.equal(await killWhenLive(svc, executionId), true);
  await pending;

  assert.equal(killed.length, 1);
  assert.equal(killed[0]?.executionId, executionId);
  assert.equal(killed[0]?.workspaceId, 'ws-kill');
  assert.equal(killed[0]?.toolCallId, 'tool-1');
  assert.equal(killed[0]?.signal, 'SIGKILL');
});

test('kill: generated id is used when caller provides none', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({ command: 'echo hello', cwd: root, policy: ALLOW_POLICY });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(
    r.executionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});
