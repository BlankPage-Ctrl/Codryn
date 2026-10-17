import { z } from 'zod';
import { randomUUID } from 'node:crypto';
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
  runId?: string;
  callScope?: string;

  signal?: AbortSignal;
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

// Compact truncation for killed runs: only the tail matters to the model,
// unlike the roomier defaults used for successful output in guardShellOutcome.
const KILLED_TRUNCATE = {
  maxChars: 2_000,
  maxLines: 40,
  mode: 'head-tail',
  headRatio: 0.25,
} as const;

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
      const rawToolCallId = toolOptions?.toolCallId ?? null;
      // Child scopes prefix the call id so shell events stay unambiguous
      // across the workspace-global watcher.
      const toolCallId =
        rawToolCallId != null && opts.callScope
          ? `${opts.callScope}:${rawToolCallId}`
          : rawToolCallId;
      // Minted upfront so an abort racing the execution can kill the live
      // process with the same id the service tracks.
      const executionId = randomUUID();
      const signals = [opts.signal, toolOptions?.signal].filter(
        (s): s is AbortSignal => s instanceof AbortSignal,
      );
      let onAbort: (() => void) | undefined;
      if (signals.length > 0) {
        onAbort = () => {
          consumer.killRun(executionId);
        };
        for (const signal of signals) {
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
      }
      let result: Awaited<ReturnType<typeof consumer.run>>;
      try {
        result = await consumer.run(
          command,
          { cwd, timeoutMs, executionId, ...(signals[0] ? { signal: signals[0] } : {}) },
          {
            toolCallId,
            chatId: opts.chatId ?? null,
            runId: opts.runId ?? null,
          },
        );
      } finally {
        if (onAbort) {
          for (const signal of signals) signal.removeEventListener('abort', onAbort);
        }
      }

      if (isShellPendingApproval(result)) {
        if (opts.resolvePermission) {
          const outcome = await opts.resolvePermission(result);
          if (!outcome.ok && outcome.error.code === 'SHELL_KILLED') {
            return toRunResult(await formatKilledOutcome(outcome, consumer.workspaceRoot));
          }
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

      if (!result.ok && result.error.code === 'SHELL_KILLED') {
        return toRunResult(await formatKilledOutcome(result, consumer.workspaceRoot));
      }

      const guarded = await guardShellOutcome(result, consumer.workspaceRoot);
      emitRich(guarded, toolCallId);
      return toRunResult(guarded);
    },
  };

  return [runShell];
}

/**
 * Enriches a SHELL_KILLED denial with the compacted tail of the partial
 * output, so the model sees what the command produced before the user
 * stopped it. Spills to disk like successful output when truncated.
 */
async function formatKilledOutcome(
  outcome: Extract<ShellOutcome, { ok: false }>,
  projectPath: string,
): Promise<Extract<ShellOutcome, { ok: false }>> {
  const details = (outcome.error.details ?? {}) as {
    stdout?: unknown;
    stderr?: unknown;
  };
  const combined = [details.stdout, details.stderr]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
  if (combined.length === 0) {
    return {
      ...outcome,
      error: {
        ...outcome.error,
        message: `${outcome.error.message} (no output captured)`,
      },
    };
  }
  try {
    const truncated = await truncateToolOutput({
      content: combined,
      projectPath,
      toolName: 'run_shell',
      maxChars: KILLED_TRUNCATE.maxChars,
      maxLines: KILLED_TRUNCATE.maxLines,
      mode: KILLED_TRUNCATE.mode,
      headRatio: KILLED_TRUNCATE.headRatio,
    });
    return {
      ...outcome,
      error: {
        ...outcome.error,
        message: `${outcome.error.message}. Last output:\n${truncated.text}`,
      },
    };
  } catch {
    // Truncation must never hide the kill: fall back to a raw tail.
    return {
      ...outcome,
      error: {
        ...outcome.error,
        message: `${outcome.error.message}. Last output:\n${combined.slice(-KILLED_TRUNCATE.maxChars)}`,
      },
    };
  }
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
