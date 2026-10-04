import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  defaultGlobalShellConfig,
  defaultTerminalPolicy,
  isShellPendingApproval,
  ShellExecutor,
  ShellRepository,
  ShellService,
  type GlobalShellConfig,
  type TerminalPolicy,
} from '../../src/shell/index.js';

function makeService(config: Partial<GlobalShellConfig> = {}) {
  return new ShellService(
    new ShellRepository(new ShellExecutor()),
    defaultGlobalShellConfig(config),
  );
}

async function tempRoot(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'shell-svc-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('service: disabled shell refuses with NOT_ENABLED', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService({ enabled: false });
  const r = await svc.run({ command: 'echo hi', cwd: root, policy: defaultTerminalPolicy() });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.code, 'NOT_ENABLED');
});

test('service: hard-denied command never executes', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService({ hardDeny: ['rm -rf /'] });
  const r = await svc.run({ command: 'rm -rf /', cwd: root, policy: defaultTerminalPolicy() });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.code, 'PERMISSION_DENIED');
  assert.match(r.error.message, /"rm" blocked by "rm -rf \/" \(hard\)/);
});

test('service: ask verdict returns pending approval with requiresApproval', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({ command: 'touch ask.txt', cwd: root, policy: defaultTerminalPolicy() });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  assert.equal(r.error.code, 'REQUIRES_APPROVAL');
  assert.equal(r.error.requiresApproval, true);
  assert.equal(r.permission.command, 'touch ask.txt');
  // abort without executing
  const denied = await r.abort();
  assert.equal(denied.error.code, 'PERMISSION_DENIED');
});

test('service: ask verdict can be approved via confirm callback', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  // `node --version` runs on every platform (unlike `touch`); intent here is
  // the approval flow, not file creation.
  const r = await svc.run({
    command: 'node --version',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  assert.equal(r.permission.command, 'node --version');
  const outcome = await r.confirm({ decision: 'allow' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.exitCode, 0);
});

test('service: read-only command executes and reports stdout', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  // Single arg: PowerShell `echo a b` prints one line per arg while bash
  // joins with spaces, so assert on one word for both shells.
  const r = await svc.run({ command: 'echo hello', cwd: root, policy: defaultTerminalPolicy() });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.exitCode, 0);
  assert.match(r.data.stdout, /hello/);
  assert.equal(r.data.policy.verdict, 'allow');
});

test('service: approval permission carries execution/workspace/chat identity from meta', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run(
    { command: 'touch confirmed.txt', cwd: root, policy: defaultTerminalPolicy() },
    { workspaceId: 'ws-456', chatId: 'chat-789' },
  );
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  assert.match(
    r.permission.executionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(r.permission.workspaceId, 'ws-456');
  assert.equal(r.permission.chatId, 'chat-789');
  const outcome = await r.confirm({ decision: 'allow' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.executionId, r.permission.executionId);
});

test('service: per-workspace policy overrides default mode', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const policy: TerminalPolicy = { mode: 'deny', allow: ['touch *.txt'], ask: [], deny: [] };
  const allowed = await svc.run({ command: 'touch made.txt', cwd: root, policy });
  assert.equal(allowed.ok, true);

  const refused = await svc.run({ command: 'npm install', cwd: root, policy });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'PERMISSION_DENIED');
});

test('service: parse failure refuses safely', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({
    command: 'echo "unclosed',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.code, 'PARSE_FAILED');
});
