import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  defaultGlobalShellConfig,
  isShellPendingApproval,
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

test('kill: running process is SIGKILLed and run resolves as SHELL_KILLED', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const executionId = randomUUID();

  const pending = svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId },
    { workspaceId: 'ws-1', chatId: 'chat-1' },
  );

  assert.equal(await killWhenLive(svc, executionId), true);

  const outcome = await pending;
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  if (isShellPendingApproval(outcome)) assert.fail('unexpected pending approval');
  assert.equal(outcome.executionId, executionId);
  assert.equal(outcome.error.code, 'SHELL_KILLED');

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
    assert.equal(outcome.ok, false);
    if (outcome.ok) continue;
    assert.equal(outcome.error.code, 'SHELL_KILLED');
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
  assert.match(r.executionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('kill: killRunsForRun only kills runs of that run id', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();

  const pendingA = svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId: randomUUID() },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: 'run-a' },
  );
  const pendingB = svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, executionId: randomUUID() },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: 'run-b' },
  );

  // Wait until both processes spawned: killRunsForRun only sees tracked runs.
  const deadline = Date.now() + 10_000;
  let swept = svc.killRunsForRun('run-a');
  while (swept.killedCount !== 1 && Date.now() <= deadline) {
    await new Promise((r) => setTimeout(r, 50));
    swept = svc.killRunsForRun('run-a');
  }
  assert.equal(swept.killedCount, 1);

  const outcomeA = await pendingA;
  assert.equal(outcomeA.ok, false);
  if (!outcomeA.ok) assert.equal(outcomeA.error.code, 'SHELL_KILLED');

  // The other run is untouched: kill it directly to finish the test.
  assert.deepEqual(svc.killRunsForRun('run-a'), { killedCount: 0 });
  assert.deepEqual(svc.killRunsForRun('run-b'), { killedCount: 1 });
  const outcomeB = await pendingB;
  assert.equal(outcomeB.ok, false);
  if (!outcomeB.ok) assert.equal(outcomeB.error.code, 'SHELL_KILLED');
});

test('kill: aborted signal resolves as SHELL_KILLED without spawning late', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const controller = new AbortController();
  controller.abort();

  const outcome = await svc.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY, signal: controller.signal },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: 'run-x' },
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'SHELL_KILLED');
});

test('kill: cancelPendingForRun aborts waiting approvals as SHELL_KILLED', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const askPolicy: TerminalPolicy = { mode: 'ask', allow: [], ask: [], deny: [] };

  const pending = await svc.run(
    { command: 'touch test.txt', cwd: root, policy: askPolicy },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: 'run-p' },
  );
  assert.equal(pending.ok, false);
  if (pending.ok) return;
  assert.equal(pending.error.code, 'REQUIRES_APPROVAL');

  const cancelled = await svc.cancelPendingForRun('run-p');
  assert.equal(cancelled.cancelledCount, 1);
  assert.equal((await svc.cancelPendingForRun('run-p')).cancelledCount, 0);
  assert.equal((await svc.cancelPendingForRun('other-run')).cancelledCount, 0);
});

/** Distinctive sleep durations so `ps` matches cannot collide with the host. */
const TREE_SLEEP = 'sleep 47';
const TIMEOUT_SLEEP = 'sleep 48';

function liveProcessArgs(): string {
  try {
    return execSync('ps -eo args', { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

async function waitForProcessGone(marker: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const args = liveProcessArgs();
    const stillThere = args
      .split('\n')
      .some((line) => line.includes(marker) && !line.includes('ps -eo'));
    if (!stillThere) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('kill: the whole process tree dies, not just the wrapper shell', async (t) => {
  if (process.platform === 'win32') {
    t.skip('process-group kill is POSIX-only');
    return;
  }
  const root = await tempRoot(t);
  const svc = makeService();
  const executionId = randomUUID();

  const pending = svc.run(
    { command: TREE_SLEEP, cwd: root, policy: ALLOW_POLICY, executionId },
    { workspaceId: 'ws-1', chatId: 'chat-1' },
  );

  assert.equal(await killWhenLive(svc, executionId), true);
  const outcome = await pending;
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'SHELL_KILLED');

  // The `sleep` child of the wrapper shell must be gone too, not orphaned.
  assert.equal(await waitForProcessGone(TREE_SLEEP), true);
});

test('timeout: expiry kills the whole process tree and reports timedOut', async (t) => {
  if (process.platform === 'win32') {
    t.skip('process-group kill is POSIX-only');
    return;
  }
  const root = await tempRoot(t);
  const svc = makeService();

  const outcome = await svc.run(
    { command: TIMEOUT_SLEEP, cwd: root, policy: ALLOW_POLICY, timeoutMs: 800 },
    { workspaceId: 'ws-1', chatId: 'chat-1' },
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.timedOut, true);

  assert.equal(await waitForProcessGone(TIMEOUT_SLEEP), true);
});
