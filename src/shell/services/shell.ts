import { randomUUID } from 'node:crypto';
import { createSecureDefaults, defaultTerminalPolicy } from '../engines/presets.js';
import { parseShell } from '../engines/parser.js';
import { evaluatePolicy } from '../engines/policy.js';
import { stripAnsiText } from '../engines/output.js';
import type { ShellRepository } from '../repository/shell.js';
import type {
  GlobalShellConfig,
  IShellExecEventBus,
  IShellService,
  PolicyDecision,
  SegmentInfo,
  ShellDeniedOutcome,
  ShellKillAllResult,
  ShellKillResult,
  ShellOutcome,
  ShellRunData,
  ShellRunMeta,
  ShellRunOptions,
  ShellRunResult,
  ShellPendingApproval,
  ShellPermissionCallback,
  ShellPermissionConfirmation,
  ShellPermissionInput,
} from '../types/index.js';
import type { ExecOutput } from '../types/index.js';
import { ValidationError } from '../errors/validation.js';
import { ExecutionError } from '../errors/execution.js';

const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/** Signal sent by killRun/killAllRuns. SIGKILL cannot be caught or ignored. */
const KILL_SIGNAL = 'SIGKILL';

interface ActiveRunMeta {
  toolCallId: string | null;
  workspaceId: string | null;
  command: string;
  cwd: string;
}

/**
 * Orchestrates the shell execution pipeline: parse -> policy -> (approval?) ->
 * execute -> format. The global hard-deny list is enforced here, on the only
 * execution path the backend exposes, so neither the model nor the system can
 * bypass it.
 *
 * When a command requires approval (verdict `ask`), this service does NOT
 * call HITL itself. It returns a `ShellPendingApproval` containing the
 * permission input and a `confirm` callback that captures the execution
 * closure. The caller (apps/) is responsible for asking the user via HITL
 * and invoking `confirm({decision:'allow'})` or `abort()`.
 */
export class ShellService implements IShellService {
  constructor(
    private readonly repository: ShellRepository,
    private readonly globalConfig: GlobalShellConfig,
    private readonly eventBus?: IShellExecEventBus,
  ) {}

  /**
   * Routing metadata for live runs, keyed by execution id. Kept separate
   * from workspace/chat storage on purpose: killing a run only needs the
   * execution id, Entries are removed when the run settles.
   */
  private readonly activeMeta = new Map<string, ActiveRunMeta>();
  /** Ids with a kill already signalled; keeps `killed` events one-per-run. */
  private readonly killRequested = new Set<string>();

  /**
   * Best-effort kill of one live run. Idempotent and never throws for unknown ids:
   * an id that is unknown, already finished, or already kill-requested
   * returns `{ killed: false }` (one `killed` event per run at most).
   */
  killRun(executionId: string): ShellKillResult {
    if (!executionId) return { executionId, killed: false };
    if (this.killRequested.has(executionId)) return { executionId, killed: false };
    const killed = this.repository.kill(executionId);
    if (!killed) return { executionId, killed: false };
    this.killRequested.add(executionId);
    const meta = this.activeMeta.get(executionId);
    this.eventBus?.emit('killed', {
      executionId,
      toolCallId: meta?.toolCallId ?? null,
      workspaceId: meta?.workspaceId ?? null,
      signal: KILL_SIGNAL,
      at: Date.now(),
    });
    return { executionId, killed: true };
  }

  /**
   * Best-effort kill of every live run (shutdown path). Never throws; a
   * failing kill is skipped and the sweep continues.
   */
  killAllRuns(): ShellKillAllResult {
    let killedCount = 0;
    for (const executionId of [...this.activeMeta.keys()]) {
      try {
        if (this.killRun(executionId).killed) killedCount += 1;
      } catch {
        // best-effort: keep sweeping the rest
      }
    }
    return { killedCount };
  }

  async run(opts: ShellRunOptions, meta?: ShellRunMeta): Promise<ShellRunResult> {
    // Caller-provided ids let someone kill the run mid-process with
    // the same id; otherwise mint one. Reused ids are last-write-wins.
    const executionId = opts.executionId || randomUUID();
    const toolCallId = meta?.toolCallId ?? null;
    const workspaceId = meta?.workspaceId ?? null;
    const chatId = meta?.chatId ?? null;

    if (!this.globalConfig.enabled) {
      return this.deny('NOT_ENABLED', 'Shell execution is disabled', false, null, executionId);
    }

    const parsed = parseShell(opts.command, { shell: this.globalConfig.shell });
    if (!parsed.ok) {
      return this.deny(
        'PARSE_FAILED',
        parsed.reason ?? 'command could not be parsed',
        false,
        null,
        executionId,
      );
    }

    const workspacePolicy = opts.policy ?? defaultTerminalPolicy();
    const hardDeny = [...createSecureDefaults(), ...this.globalConfig.hardDeny];
    const decision = evaluatePolicy(parsed.segments, workspacePolicy, hardDeny, {
      shell: this.globalConfig.shell,
    });

    if (decision.verdict === 'deny') {
      const denied = this.deny(
        'PERMISSION_DENIED',
        this.describeDecision(decision),
        false,
        decision,
        executionId,
      );
      if (this.eventBus) {
        this.eventBus.emit('error', {
          executionId,
          toolCallId,
          workspaceId,
          code: 'PERMISSION_DENIED',
          message: denied.error.message,
          details: denied.error.policy,
        });
      }
      return denied;
    }

    if (decision.verdict === 'ask') {
      return this.createPendingApproval(opts, decision, {
        executionId,
        toolCallId,
        workspaceId,
        chatId,
      });
    }

    return this.execute(opts, decision, {
      executionId,
      toolCallId,
      workspaceId,
      chatId,
    });
  }

  private createPendingApproval(
    opts: ShellRunOptions,
    decision: PolicyDecision,
    ids: {
      executionId: string;
      toolCallId: string | null;
      workspaceId: string | null;
      chatId: string | null;
    },
  ): ShellPendingApproval {
    const permission = this.buildPermissionInput(opts, decision, ids);

    const confirm: ShellPermissionCallback = async (
      confirmation: ShellPermissionConfirmation,
    ): Promise<ShellOutcome> => {
      if (confirmation.decision !== 'allow') {
        const denied = this.deny(
          'PERMISSION_DENIED',
          `Command rejected by user approval: ${this.describeDecision(decision)}`,
          false,
          decision,
          ids.executionId,
        );
        if (this.eventBus) {
          this.eventBus.emit('error', {
            executionId: ids.executionId,
            toolCallId: ids.toolCallId,
            workspaceId: ids.workspaceId,
            code: 'PERMISSION_DENIED',
            message: denied.error.message,
            details: denied.error.policy,
          });
        }
        return denied;
      }
      const rawModified = confirmation.modifiedCommand;
      if (rawModified !== undefined) {
        const trimmed = rawModified.trim();
        if (!trimmed) {
          const denied = this.deny(
            'PARSE_FAILED',
            'Modified command is empty',
            false,
            decision,
            ids.executionId,
            { reason: 'modificationNote empty after trim', originalCommand: opts.command },
          );
          if (this.eventBus) {
            this.eventBus.emit('error', {
              executionId: ids.executionId,
              toolCallId: ids.toolCallId,
              workspaceId: ids.workspaceId,
              code: 'PARSE_FAILED',
              message: denied.error.message,
              details: denied.error.details,
            });
          }
          return denied;
        }
        if (trimmed !== opts.command) {
          const parsedMod = parseShell(trimmed, { shell: this.globalConfig.shell });
          if (!parsedMod.ok) {
            const denied = this.deny(
              'PARSE_FAILED',
              parsedMod.reason ?? 'modified command could not be parsed',
              false,
              decision,
              ids.executionId,
              { reason: parsedMod.reason, modifiedCommand: trimmed },
            );
            if (this.eventBus) {
              this.eventBus.emit('error', {
                executionId: ids.executionId,
                toolCallId: ids.toolCallId,
                workspaceId: ids.workspaceId,
                code: 'PARSE_FAILED',
                message: denied.error.message,
                details: denied.error.details,
              });
            }
            return denied;
          }
          const workspacePolicy = opts.policy ?? defaultTerminalPolicy();
          const hardDeny = [...createSecureDefaults(), ...this.globalConfig.hardDeny];
          const modDecision = evaluatePolicy(parsedMod.segments, workspacePolicy, hardDeny, {
            shell: this.globalConfig.shell,
          });
          if (modDecision.verdict === 'deny') {
            const denied = this.deny(
              'PERMISSION_DENIED',
              this.describeDecision(modDecision),
              false,
              modDecision,
              ids.executionId,
              { modifiedCommand: trimmed, reason: 'modified command violates policy' },
            );
            if (this.eventBus) {
              this.eventBus.emit('error', {
                executionId: ids.executionId,
                toolCallId: ids.toolCallId,
                workspaceId: ids.workspaceId,
                code: 'PERMISSION_DENIED',
                message: denied.error.message,
                details: denied.error.policy,
              });
            }
            return denied;
          }
          const runOpts: ShellRunOptions = { ...opts, command: trimmed };
          return this.execute(runOpts, modDecision, ids);
        }
      }
      return this.execute(opts, decision, ids);
    };

    const abort = async (): Promise<ShellDeniedOutcome> => {
      const denied = this.deny(
        'PERMISSION_DENIED',
        `Command rejected by user approval: ${this.describeDecision(decision)}`,
        false,
        decision,
        ids.executionId,
      ) as ShellDeniedOutcome;
      if (this.eventBus) {
        this.eventBus.emit('error', {
          executionId: ids.executionId,
          toolCallId: ids.toolCallId,
          workspaceId: ids.workspaceId,
          code: 'PERMISSION_DENIED',
          message: denied.error.message,
          details: denied.error.policy,
        });
      }
      return denied;
    };

    return {
      ok: false,
      error: {
        code: 'REQUIRES_APPROVAL',
        message: `Command requires manual approval: ${this.describeDecision(decision)}`,
        requiresApproval: true,
        policy: {
          verdict: decision.verdict,
          reason: this.describeDecision(decision),
          segments: toSegmentInfo(decision),
        },
      },
      permission,
      confirm,
      abort,
    };
  }

  private async execute(
    opts: ShellRunOptions,
    decision: PolicyDecision,
    ids: {
      executionId: string;
      toolCallId: string | null;
      workspaceId: string | null;
      chatId: string | null;
    },
  ): Promise<ShellOutcome> {
    const timeoutMs = opts.timeoutMs ?? this.globalConfig.defaultTimeoutMs;

    // Registered before `start` so observers (and killers) always see it.
    this.activeMeta.set(ids.executionId, {
      toolCallId: ids.toolCallId,
      workspaceId: ids.workspaceId,
      command: opts.command,
      cwd: opts.cwd,
    });

    if (this.eventBus) {
      this.eventBus.emit('start', {
        executionId: ids.executionId,
        toolCallId: ids.toolCallId,
        workspaceId: ids.workspaceId,
        command: opts.command,
        cwd: opts.cwd,
      });
    }

    let raw: ExecOutput;
    try {
      raw = await this.repository.runStream(
        {
          command: opts.command,
          shell: this.globalConfig.shell,
          cwd: opts.cwd,
          env: opts.env,
          timeoutMs,
          maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
        },
        (chunk) => {
          this.eventBus?.emit('chunk', {
            executionId: ids.executionId,
            toolCallId: ids.toolCallId,
            workspaceId: ids.workspaceId,
            ...chunk,
          });
        },
        ids.executionId,
      );
    } catch (err) {
      // Validation errors are programmer errors? propagate, never mislabel as execution failure.
      if (err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const details =
        err instanceof ExecutionError
          ? err.details
          : { cause: message, command: opts.command, cwd: opts.cwd };
      if (this.eventBus) {
        this.eventBus.emit('error', {
          executionId: ids.executionId,
          toolCallId: ids.toolCallId,
          workspaceId: ids.workspaceId,
          code: 'EXECUTION_FAILED',
          message,
          details,
        });
      }
      return this.deny(
        'EXECUTION_FAILED',
        `Failed to execute command: ${message}`,
        false,
        decision,
        ids.executionId,
        details,
      );
    } finally {
      this.activeMeta.delete(ids.executionId);
      this.killRequested.delete(ids.executionId);
    }

    const stdout = stripAnsiText(raw.stdout);
    const stderr = stripAnsiText(raw.stderr);
    const interleaved = stripAnsiText(raw.interleaved);

    const data: ShellRunData = {
      command: opts.command,
      cwd: opts.cwd,
      exitCode: raw.exitCode,
      stdout,
      stderr,
      interleaved,
      stdoutAnsi: raw.stdout,
      stderrAnsi: raw.stderr,
      interleavedAnsi: raw.interleaved,
      truncated: false,
      spillPath: null,
      durationMs: raw.durationMs,
      timedOut: raw.timedOut,
      signal: raw.signal,
      policy: {
        verdict: decision.verdict,
        segments: toSegmentInfo(decision),
      },
    };

    if (this.eventBus) {
      this.eventBus.emit('done', {
        executionId: ids.executionId,
        toolCallId: ids.toolCallId,
        workspaceId: ids.workspaceId,
        data,
      });
    }
    return { ok: true, data, executionId: ids.executionId };
  }

  private deny(
    code: ShellDeniedOutcome['error']['code'],
    message: string,
    requiresApproval: boolean,
    decision: PolicyDecision | null,
    executionId: string,
    details?: unknown,
  ): ShellDeniedOutcome {
    return {
      ok: false,
      error: {
        code,
        message,
        requiresApproval,
        ...(details !== undefined ? { details } : {}),
        ...(decision
          ? {
              policy: {
                verdict: decision.verdict,
                reason: message,
                segments: toSegmentInfo(decision),
              },
            }
          : {}),
      },
      executionId,
    };
  }

  private describeDecision(decision: PolicyDecision): string {
    const culprit =
      decision.segments.find((s) => s.verdict === 'deny') ??
      decision.segments.find((s) => s.verdict === 'ask');
    if (!culprit) return 'policy evaluation rejected the command';

    const match = culprit.match;
    const tier = match?.tier ?? 'default';
    const pattern = match?.pattern ? `"${match.pattern}" (${tier})` : tier;
    const reason = culprit.reason ? ` — ${culprit.reason}` : '';
    return `"${culprit.segment.cmd}" blocked by ${pattern}${reason}`;
  }

  private buildPermissionInput(
    opts: ShellRunOptions,
    decision: PolicyDecision,
    ids: {
      executionId: string;
      toolCallId: string | null;
      workspaceId: string | null;
      chatId: string | null;
    },
  ): ShellPermissionInput {
    const culprit = decision.segments.find((s) => s.verdict === 'ask');
    return {
      command: opts.command,
      cwd: opts.cwd,
      segments: toSegmentInfo(decision),
      matched: {
        pattern: culprit?.match?.pattern ?? '',
        tier: culprit?.match?.tier ?? 'default',
      },
      reason: this.describeDecision(decision),
      policy: {
        verdict: decision.verdict,
        segments: toSegmentInfo(decision),
      },
      executionId: ids.executionId,
      workspaceId: ids.workspaceId,
      chatId: ids.chatId,
      toolCallId: ids.toolCallId,
    };
  }
}

function toSegmentInfo(decision: PolicyDecision): SegmentInfo[] {
  return decision.segments.map((s) => ({ cmd: s.segment.cmd, args: s.segment.args }));
}
