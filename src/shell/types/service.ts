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
}

export interface ShellRunMeta {
  toolCallId?: string | null;
  workspaceId?: string | null;
  chatId?: string | null;
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
}
