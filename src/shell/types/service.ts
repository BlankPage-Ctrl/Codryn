import type { ShellErrorCode } from './error-codes.js';
import type { SegmentInfo } from './info.js';
import type { ShellRunData } from './result.js';
import type { TerminalPolicy } from './policy.js';

export interface ShellRunOptions {
  command: string;
  /** Absolute directory the command runs in. */
  cwd: string;
  /**
   * Pre-resolved per-workspace policy. When absent, the safe default
   * (mode `ask`, no grants) is used.
   */
  policy?: TerminalPolicy;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: Record<string, string>;
  /**
   * Caller-provided in-memory run id. Lets the caller
   * kill the run mid-process with `killRun()` using the same id. Must be
   * unique per run; when absent the service generates one.
   */
  executionId?: string;
  /**
   * Optional abort signal for user cancellation. When aborted (before or
   * during execution) the run is SIGKILLed and reported as `SHELL_KILLED`
   * instead of a success result.
   */
  signal?: AbortSignal;
}

export interface ShellRunMeta {
  toolCallId?: string | null;
  workspaceId?: string | null;
  chatId?: string | null;
  runId?: string | null;
}

export interface ShellAllowedOutcome {
  ok: true;
  data: ShellRunData;
  executionId: string;
}

export interface ShellDeniedOutcome {
  ok: false;
  error: {
    code: ShellErrorCode;
    message: string;
    requiresApproval: boolean;
    details?: unknown;
    policy?: {
      verdict: string;
      reason?: string;
      segments: SegmentInfo[];
    };
  };
  executionId: string;
}

export type ShellOutcome = ShellAllowedOutcome | ShellDeniedOutcome;
export interface ShellPermissionInput {
  command: string;
  cwd: string;
  segments: SegmentInfo[];
  matched: { pattern: string; tier: string };
  reason?: string;
  policy: {
    verdict: string;
    segments: SegmentInfo[];
  };
  executionId: string;
  workspaceId: string | null;
  chatId: string | null;
  toolCallId: string | null;
}

export type ShellPermissionDecision = 'allow' | 'deny';

export interface ShellPermissionConfirmation {
  decision: ShellPermissionDecision;
  /** Optional modified command when user approved with modification. */
  modifiedCommand?: string;
  reason?: string;
}

export type ShellPermissionCallback = (
  confirmation: ShellPermissionConfirmation,
) => Promise<ShellOutcome>;

export interface ShellPendingApproval {
  ok: false;
  error: {
    code: 'REQUIRES_APPROVAL';
    message: string;
    requiresApproval: true;
    policy: {
      verdict: string;
      reason?: string;
      segments: SegmentInfo[];
    };
  };
  permission: ShellPermissionInput;
  confirm: ShellPermissionCallback;
  abort: () => Promise<ShellDeniedOutcome>;
}

export type ShellRunResult = ShellOutcome | ShellPendingApproval;

export interface ShellKillResult {
  executionId: string;
  /** True when a live process was found and signalled with SIGKILL. */
  killed: boolean;
}

export interface ShellKillAllResult {
  /** Number of live processes that were signalled. */
  killedCount: number;
}

export function isShellPendingApproval(result: ShellRunResult): result is ShellPendingApproval {
  return (
    !result.ok &&
    result.error.requiresApproval === true &&
    'permission' in result &&
    typeof (result as ShellPendingApproval).confirm === 'function'
  );
}

export interface IShellService {
  run(opts: ShellRunOptions, meta?: ShellRunMeta): Promise<ShellRunResult>;
  /**
   * Best-effort kill of one run by its in-memory execution id.
   * Idempotent: unknown or already-finished ids return `{ killed: false }`.
   */
  killRun(executionId: string): ShellKillResult;
  /** Best-effort kill of every live run. Used on shutdown. Never throws. */
  killAllRuns(): ShellKillAllResult;
  /**
   * Best-effort kill of every live run started under one agent run id.
   * Never throws; used when the user cancels a message run.
   */
  killRunsForRun(runId: string): ShellKillAllResult;
  /**
   * Best-effort abort of every approval-pending shell started under one
   * agent run id. Each pending run is reported as `SHELL_KILLED`.
   * Never throws; used when the user cancels a message run.
   */
  cancelPendingForRun(runId: string): Promise<{ cancelledCount: number }>;
}
