import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cancelMessageRun } from '../../apps/actions/cancel.message-run.js';
import type { Container } from '../../apps/bootstrap.js';
import { RunHotStorage, RunsRepository, RunsService } from '../../src/runs/index.js';
import {
  ShellExecEventBus,
  ShellExecutor,
  ShellRepository,
  ShellService,
  type TerminalPolicy,
} from '../../src/shell/index.js';
import { defaultGlobalShellConfig } from '../../apps/shared/shell-consumer.js';

const ALLOW_POLICY: TerminalPolicy = { mode: 'allow', allow: [], ask: [], deny: [] };
const ASK_POLICY: TerminalPolicy = { mode: 'ask', allow: [], ask: [], deny: [] };
const SLEEP_COMMAND = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';

function makeShellService(bus?: ShellExecEventBus): ShellService {
  return new ShellService(
    new ShellRepository(new ShellExecutor()),
    defaultGlobalShellConfig({ defaultTimeoutMs: 60_000 }),
    bus ?? new ShellExecEventBus(),
  );
}

function makeCtx(deps: {
  runService: RunsService;
  shellService: ShellService;
  hitlPending?: Array<{
    id: string;
    chatId: string;
    metadata: Record<string, string | number | boolean>;
  }>;
  cancelledHitlIds?: string[];
}): Container {
  return {
    chatService: { findOne: async () => ({ id: 'chat-1' }) },
    runService: deps.runService,
    shellService: deps.shellService,
    hitlService: {
      listPending: async () => deps.hitlPending ?? [],
      cancel: async (id: string) => {
        deps.cancelledHitlIds?.push(id);
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as Container;
}

async function tempRoot(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cancel-run-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('cancelMessageRun kills the live shell of the run as SHELL_KILLED', async (t) => {
  const root = await tempRoot(t);
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));
  const bus = new ShellExecEventBus();
  const shellService = makeShellService(bus);
  const ctx = makeCtx({ runService, shellService });

  const run = await runService.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });

  const started = new Promise<void>((resolve) => {
    bus.on('start', () => resolve());
  });
  const shellPending = shellService.run(
    { command: SLEEP_COMMAND, cwd: root, policy: ALLOW_POLICY },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: run.runId, toolCallId: 'tool-1' },
  );
  await started;

  const finished = await cancelMessageRun(ctx, {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  assert.equal(finished.status, 'cancelled');

  const outcome = await shellPending;
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'SHELL_KILLED');
});

test('cancelMessageRun aborts pending approvals and cancels shell HITL requests', async (t) => {
  const root = await tempRoot(t);
  void root;
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));
  const shellService = makeShellService();
  const cancelledHitlIds: string[] = [];
  const ctx = makeCtx({
    runService,
    shellService,
    hitlPending: [
      { id: 'hitl-shell-1', chatId: 'chat-1', metadata: { source: 'shell' } },
      { id: 'hitl-other-1', chatId: 'chat-1', metadata: { source: 'ask' } },
      { id: 'hitl-shell-2', chatId: 'chat-2', metadata: { source: 'shell' } },
    ],
    cancelledHitlIds,
  });

  const run = await runService.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });

  // One approval-pending shell under this run, one under another run.
  const pending = await shellService.run(
    { command: 'touch test.txt', cwd: tmpdir(), policy: ASK_POLICY },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: run.runId, toolCallId: 'tool-1' },
  );
  assert.equal(pending.ok, false);
  if (pending.ok) return;
  assert.equal(pending.error.code, 'REQUIRES_APPROVAL');
  const otherPending = await shellService.run(
    { command: 'touch other.txt', cwd: tmpdir(), policy: ASK_POLICY },
    { workspaceId: 'ws-1', chatId: 'chat-1', runId: 'run-other', toolCallId: 'tool-2' },
  );
  assert.equal(otherPending.ok, false);

  const finished = await cancelMessageRun(ctx, {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  assert.equal(finished.status, 'cancelled');

  // Only the shell approval request of this chat was cancelled.
  assert.deepEqual(cancelledHitlIds, ['hitl-shell-1']);
  // Only this run's pending approval was dropped; the other run still waits.
  assert.equal((await shellService.cancelPendingForRun(run.runId)).cancelledCount, 0);
  assert.equal((await shellService.cancelPendingForRun('run-other')).cancelledCount, 1);
});

test('cancelMessageRun on a settled run does nothing', async (t) => {
  void t;
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));
  const shellService = makeShellService();
  const ctx = makeCtx({ runService, shellService });

  const run = await runService.create({
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    assistantMessageId: 'msg-1',
  });
  await runService.finish(run.runId, 'done');

  const finished = await cancelMessageRun(ctx, {
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    runId: run.runId,
  });
  assert.equal(finished.status, 'done');
});
