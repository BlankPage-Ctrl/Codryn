import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createShellTool } from '../../apps/agent/tools/shell.js';
import { createSubAgentTool } from '../../apps/agent/subagents/delegate.js';
import { BUILTIN_SUBAGENTS } from '../../apps/agent/subagents/builtin.js';
import type { AgentClient, AgentTool, ResolvedModel } from '../../src/agent/index.js';
import type { ShellConsumer, ShellOutcome } from '../../src/shell/index.js';

const PARENT_MODEL: ResolvedModel = {
  providerConfig: { id: 'p1', type: 'openai', name: 'test', apiKey: 'k' },
  modelId: 'parent-model',
};

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

function stubTool(name: string): AgentTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: z.object({}),
    execute: async () => `ok:${name}`,
  };
}

test('run_shell kills the live command when the agent aborts the tool', async () => {
  const killed: string[] = [];
  let settle: ((outcome: ShellOutcome) => void) | null = null;
  const consumer = {
    workspaceRoot: '/tmp',
    run: () =>
      new Promise<ShellOutcome>((resolve) => {
        settle = resolve;
      }),
    killRun: (executionId: string) => {
      killed.push(executionId);
      settle?.({
        ok: true,
        executionId,
        data: {
          command: 'sleep 60',
          cwd: '/tmp',
          exitCode: 0,
          stdout: '',
          stderr: '',
          interleaved: '',
          stdoutAnsi: '',
          stderrAnsi: '',
          interleavedAnsi: '',
          truncated: false,
          spillPath: null,
          durationMs: 1,
          timedOut: false,
          signal: 'SIGKILL',
          policy: { verdict: 'allow', segments: [] },
        },
      });
      return { killed: true };
    },
    // SAFE: test double for the class the tool only calls on.
  } as unknown as ShellConsumer;

  const [tool] = createShellTool(consumer, { chatId: 'chat-1' });
  const controller = new AbortController();
  const pending = tool.execute({ command: 'sleep 60' }, { abortSignal: controller.signal });
  controller.abort();
  const result = (await pending) as { executionId: string };

  assert.equal(killed.length, 1);
  assert.equal(result.executionId, killed[0]);
});

function abortingAgent(): Pick<AgentClient, 'loop'> {
  return {
    loop: (async (opts: { abortSignal?: AbortSignal }) => {
      await new Promise<never>((_resolve, reject) => {
        opts.abortSignal?.addEventListener(
          'abort',
          () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      });
      return { text: Promise.resolve('never') };
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
  };
}

test('delegate_task stops the child when the agent aborts the tool', async () => {
  const [tool] = createSubAgentTool({
    agents: BUILTIN_SUBAGENTS,
    parentModel: PARENT_MODEL,
    agent: abortingAgent(),
    baseTools: [stubTool('read_file')],
    resolveModelHint: async () => null,
    logger: NOOP_LOGGER,
  });

  const controller = new AbortController();
  const pending = tool!.execute(
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    { abortSignal: controller.signal },
  );
  controller.abort();
  const out = (await pending) as string;

  assert.ok(out.includes('`CHILD_ABORTED`'));
});
