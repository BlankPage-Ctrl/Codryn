import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import { toRunShellRichBody, type OnRichResult } from './rich-result.js';
import type { ShellConsumer, ShellOutcome, ShellRunData } from '../../../src/shell/index.js';
import { isShellPendingApproval } from '../../../src/shell/index.js';
import { truncateToolOutput } from '../utils/truncate.js';

export const runShellSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(16_000)
    .describe('Shell command to execute inside the workspace folder'),
  cwd: z
    .string()
    .optional()
    .describe('Relative working directory inside the workspace. Defaults to the workspace root.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(300_000)
    .optional()
    .describe('Execution timeout in milliseconds'),
});

function toRunResult(outcome: ShellOutcome) {
  const executionId = outcome.executionId;
  if (!outcome.ok) {
    const error = outcome.error;
    return {
      executionId,
      error: `${error.code}: ${error.message}`,
      requiresApproval: error.requiresApproval,
      auditedSegments: error.policy?.segments ?? [],
    };
  }
  const data = outcome.data;
  return {
    executionId,
    command: data.command,
    cwd: data.cwd,
    exitCode: data.exitCode,
    durationMs: data.durationMs,
    timedOut: data.timedOut,
    signal: data.signal,
    stdout: data.stdout,
    stderr: data.stderr,
    truncated: data.truncated,
    spillPath: data.spillPath,
  };
}

export interface ShellToolOptions {
  chatId?: string;
  /**
   * Called when the shell requires user approval. When absent, the tool
   * immediately returns the REQUIRES_APPROVAL error to the LLM.
   * The resolver should ask HITL and invoke `pending.confirm`/`abort`.
   */
  resolvePermission?: (
    pending: import('../../../src/shell/index.js').ShellPendingApproval,
  ) => Promise<ShellOutcome>;
  onRichResult?: OnRichResult;
}

export function createShellTool(
  consumer: ShellConsumer,
  options: ShellToolOptions | string = {},
): AgentTool[] {
  const opts: ShellToolOptions = typeof options === 'string' ? { chatId: options } : options;
  function emitRich(outcome: ShellOutcome, toolCallId: string | null): void {
    if (!outcome.ok) return;
    if (toolCallId == null || opts.onRichResult == null) return;
    opts.onRichResult({
      toolCallId,
      implement: 'run_shell',
      body: toRunShellRichBody(toolCallId, outcome.executionId, outcome.data),
    });
  }
  const runShell: AgentTool<typeof runShellSchema> = {
    name: 'run_shell',
    description: 'Execute a shell command in the workspace. Refused when policy denies it. ',
    inputSchema: runShellSchema,
    execute: async (
      { command, cwd, timeoutMs }: z.infer<typeof runShellSchema>,
      toolOptions?: AgentToolExecuteOptions,
    ) => {
      const toolCallId = toolOptions?.toolCallId ?? null;
      const result = await consumer.run(
        command,
        { cwd, timeoutMs },
        {
          toolCallId,
          chatId: opts.chatId ?? null,
        },
      );

      if (isShellPendingApproval(result)) {
        if (opts.resolvePermission) {
          const outcome = await opts.resolvePermission(result);
          const guarded = await guardShellOutcome(outcome, consumer.workspaceRoot);
          emitRich(guarded, toolCallId);
          return toRunResult(guarded);
        }
        return toRunResult({
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            requiresApproval: true,
            policy: result.error.policy,
          },
          executionId: result.permission.executionId,
        });
      }

      const guarded = await guardShellOutcome(result, consumer.workspaceRoot);
      emitRich(guarded, toolCallId);
      return toRunResult(guarded);
    },
  };

  return [runShell];
}

async function guardShellOutcome(
  outcome: ShellOutcome,
  projectPath: string,
): Promise<ShellOutcome> {
  if (!outcome.ok) return outcome;
  const data = outcome.data;
  // Build content to guard: combine stdout + stderr as the LM would see it.
  // If both empty, nothing to guard.
  const combined = [data.stdout, data.stderr].filter((s) => s.trim().length > 0).join('\n');
  if (combined.length === 0) return outcome;
  try {
    const guarded = await truncateToolOutput({
      content: combined,
      projectPath,
      toolName: 'run_shell',
      mode: 'head-tail',
      headRatio: 0.25,
    });
    if (!guarded.truncated || !guarded.spillPath) return outcome;
    const ansiCombined = [data.stdoutAnsi, data.stderrAnsi]
      .filter((s) => s.trim().length > 0)
      .join('\n');
    let nextAnsi: Pick<ShellRunData, 'stdoutAnsi' | 'stderrAnsi'> | Record<string, never> = {};
    if (ansiCombined.length > 0) {
      try {
        const guardedAnsi = await truncateToolOutput({
          content: ansiCombined,
          projectPath,
          toolName: 'run_shell',
          mode: 'head-tail',
          headRatio: 0.25,
        });
        if (guardedAnsi.truncated) {
          nextAnsi = { stdoutAnsi: guardedAnsi.text, stderrAnsi: '' };
        }
      } catch {
        // ignore
      }
    }
    return {
      ...outcome,
      data: {
        ...data,
        stdout: guarded.text,
        stderr: '',
        ...nextAnsi,
        truncated: true,
        spillPath: guarded.spillPath,
      },
    };
  } catch {
    // Guard failure should never break shell execution - return original.
    return outcome;
  }
}
