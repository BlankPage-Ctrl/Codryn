export { ShellExecutor } from './storages/cold/index.js';
export { ShellRepository } from './repository/index.js';
export { ShellService } from './services/index.js';
export * from './errors/index.js';
export { ShellExecEventBus } from './services/shell-event-bus.js';
export { ShellConsumer } from './consumers/index.js';
export {
  parseShell,
  parsePattern,
  matchRule,
  evaluatePolicy,
  parsePowerShell,
  isPowerShellShell,
  normalizePowerShellCmd,
  READONLY_COMMANDS,
  createSecureDefaults,
  defaultTerminalPolicy,
  defaultGlobalShellConfig,
  defaultShellForPlatform,
  stripAnsiText,
  formatCommandOutput,
  truncateText,
} from './engines/index.js';
export {
  TerminalPolicySchema,
  VerdictSchema,
  ShellRunDataSchema,
  ShellRunInputSchema,
  ShellErrorCodeSchema,
} from './types/index.js';
export type {
  Verdict,
  ShellSegment,
  RulePattern,
  TerminalPolicy,
  GlobalShellConfig,
  PolicyMatch,
  SegmentDecision,
  PolicyDecision,
  ShellErrorCode,
  ShellSuccess,
  ShellError,
  ShellResult,
  ShellRunData,
  ShellRunInput,
  SegmentInfo,
  ExecRunOptions,
  ExecOutput,
  IShellExecutor,
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
  IShellService,
} from './types/index.js';
export { isShellPendingApproval } from './types/index.js';
