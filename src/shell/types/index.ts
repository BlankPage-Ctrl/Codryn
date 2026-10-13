export type { Verdict } from './policy.js';
export { VerdictSchema } from './policy.js';
export type {
  ShellSegment,
  RulePattern,
  TerminalPolicy,
  GlobalShellConfig,
  PolicyMatch,
  SegmentDecision,
  PolicyDecision,
} from './policy.js';
export { TerminalPolicySchema } from './policy.js';
export type { ShellErrorCode } from './error-codes.js';
export { ShellErrorCodeSchema } from './error-codes.js';
export type {
  ShellSuccess,
  ShellError,
  ShellResult,
  ShellRunData,
  ShellRunInput,
} from './result.js';
export { ShellRunDataSchema, ShellRunInputSchema } from './result.js';
export type { SegmentInfo } from './info.js';
export type { ExecRunOptions, ExecOutput, IShellExecutor } from './executor.js';
export type {
  ShellRunOptions,
  ShellRunMeta,
  ShellPermissionInput,
  ShellPermissionDecision,
  ShellPermissionConfirmation,
  ShellPermissionCallback,
  ShellPendingApproval,
  ShellRunResult,
  ShellAllowedOutcome,
  ShellDeniedOutcome,
  ShellOutcome,
  ShellKillResult,
  ShellKillAllResult,
  IShellService,
} from './service.js';
export { isShellPendingApproval } from './service.js';
export type {
  IShellExecEventBus,
  ShellExecEventMap,
  ShellExecEventName,
  ShellExecEventHandler,
  ShellExecChunk,
  ShellExecStartPayload,
  ShellExecChunkPayload,
  ShellExecDonePayload,
  ShellExecErrorPayload,
  ShellExecKilledPayload,
} from './shell-events.js';
