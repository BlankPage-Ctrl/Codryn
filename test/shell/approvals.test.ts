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
} from '../../src/shell/index.js';

async function tempRoot(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'shell-approvals-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeService() {
  return new ShellService(new ShellRepository(new ShellExecutor()), defaultGlobalShellConfig({}));
}

test('pending: ask verdict returns ShellPendingApproval with confirm/abort', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({
    command: 'touch test.txt',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  assert.equal(r.permission.command, 'touch test.txt');
  assert.equal(r.permission.cwd, root);
  assert.equal(typeof r.confirm, 'function');
  assert.equal(typeof r.abort, 'function');
  assert.equal(r.error.code, 'REQUIRES_APPROVAL');
  assert.equal(r.error.requiresApproval, true);
  const denied = await r.abort();
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'PERMISSION_DENIED');
});

test('pending: confirm allow executes the command', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  // `node --version` runs on every platform (unlike `touch`).
  const r = await svc.run({
    command: 'node --version',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  const outcome = await r.confirm({ decision: 'allow' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.exitCode, 0);
});

test('pending: confirm deny returns PERMISSION_DENIED', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({
    command: 'touch denied.txt',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  const outcome = await r.confirm({ decision: 'deny' });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'PERMISSION_DENIED');
});

test('pending: confirm with modifiedCommand executes modified command', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run({
    command: 'touch original.txt',
    cwd: root,
    policy: defaultTerminalPolicy(),
  });
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  const outcome = await r.confirm({ decision: 'allow', modifiedCommand: 'echo modified' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.data.command, 'echo modified');
  assert.match(outcome.data.stdout, /modified/);
});

test('pending: permission carries execution/workspace/chat identity', async (t) => {
  const root = await tempRoot(t);
  const svc = makeService();
  const r = await svc.run(
    { command: 'touch identity.txt', cwd: root, policy: defaultTerminalPolicy() },
    { workspaceId: 'ws-1', chatId: 'chat-1', toolCallId: 'tool-1' },
  );
  assert.equal(isShellPendingApproval(r), true);
  if (!isShellPendingApproval(r)) return;
  assert.match(
    r.permission.executionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(r.permission.workspaceId, 'ws-1');
  assert.equal(r.permission.chatId, 'chat-1');
  assert.equal(r.permission.toolCallId, 'tool-1');
  assert.equal(r.permission.matched.tier, 'default');
  const denied = await r.abort();
  assert.equal(denied.executionId, r.permission.executionId);
});
