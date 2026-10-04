import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type {
  ShellPendingApproval,
  ShellOutcome,
  ShellPermissionInput,
} from '../../src/shell/index.js';
import type { Logger } from './types.js';
import { addWorkspaceAllowPattern, loadWorkspacePolicy } from './workspace-policy.js';

export interface ShellPermissionResolverOptions {
  title?: string | ((perm: ShellPermissionInput) => string);
  description?: (perm: ShellPermissionInput) => string | undefined;
  correlationId?: string;
  timeoutMs?: number;
  requireReasonOnReject?: boolean;
  toolCallId?: string;
  workspaceRoot?: string;
  allowlistPattern?: (perm: ShellPermissionInput) => string | null | undefined;
  /** Optional logger (file-backed). Falls back to console (captured by the console bridge). */
  logger?: Logger;
}

function isApproved(outcome: string | undefined): boolean {
  return (
    outcome === 'approved' ||
    outcome === 'always_approved' ||
    outcome === 'approved_with_modification'
  );
}

function resolveAllowPattern(
  perm: ShellPermissionInput,
  custom?: (perm: ShellPermissionInput) => string | null | undefined,
): string {
  if (custom) {
    const v = custom(perm);
    if (v && v.trim()) return v.trim();
  }
  const matched = perm.matched?.pattern?.trim();
  if (matched) return matched;
  return perm.command.trim();
}

export async function resolveShellPermissionViaHitl(
  hitl: IHitlService,
  pending: ShellPendingApproval,
  options: ShellPermissionResolverOptions = {},
): Promise<ShellOutcome> {
  const perm = pending.permission;
  const log: Logger = options.logger ?? console;

  if (options.workspaceRoot) {
    try {
      const policy = loadWorkspacePolicy(options.workspaceRoot);
      const pattern = resolveAllowPattern(perm, options.allowlistPattern);
      if (policy.allow.includes(pattern) || policy.allow.includes(perm.command.trim())) {
        return pending.confirm({ decision: 'allow' });
      }
    } catch {
      // Best-effort, fall through to HITL if policy read fails
    }
  }
  try {
    const request = await hitl.requestAndWait({
      type: 'approval',
      title:
        typeof options.title === 'function'
          ? options.title(perm)
          : (options.title ?? `Shell approval: ${perm.command}`),
      description: options.description?.(perm) ?? perm.reason,
      correlationId: options.correlationId,
      timeoutMs: options.timeoutMs,
      workspaceId: perm.workspaceId ?? undefined,
      chatId: perm.chatId ?? '',
      executionId: options.toolCallId ?? perm.toolCallId ?? undefined,
      metadata: {
        source: 'shell',
        command: perm.command,
        cwd: perm.cwd,
        matchedPattern: perm.matched.pattern,
        matchedTier: perm.matched.tier,
        shellExecutionId: perm.executionId,
      },
      payload: {
        contextPreview: {
          command: perm.command,
          cwd: perm.cwd,
          segments: perm.segments,
          matched: perm.matched,
          reason: perm.reason,
          policy: perm.policy,
        },
        modification: {
          initialValue: perm.command,
          label: 'Command',
          placeholder: 'Edit command before approving…',
        },
        requireReasonOnReject: options.requireReasonOnReject,
      },
    });

    if (request.type === 'approval' && isApproved(request.response?.outcome)) {
      const outcome = request.response?.outcome;
      const rawModified = (request.response as { modificationNote?: string })?.modificationNote;
      const modifiedCommand = rawModified?.trim() ? rawModified.trim() : undefined;
      if (outcome === 'approved_with_modification' && !modifiedCommand) {
        // `command` may embed inline secrets
        log.warn(
          { sensitive: true, command: perm.command, executionId: perm.executionId },
          '[shell-permission] approved_with_modification without valid modificationNote, aborting',
        );
        return pending.abort();
      }

      if (outcome === 'always_approved' && options.workspaceRoot) {
        try {
          const pattern = resolveAllowPattern(perm, options.allowlistPattern);
          await addWorkspaceAllowPattern(options.workspaceRoot, pattern);
        } catch (err) {
          log.warn(
            { sensitive: true, command: perm.command, workspaceRoot: options.workspaceRoot, err },
            '[shell-permission] failed to persist always_approved pattern',
          );
        }
      }

      return pending.confirm({
        decision: 'allow',
        modifiedCommand,
        reason: (request.response as { reason?: string })?.reason,
      });
    }
    return pending.abort();
  } catch (err) {
    log.warn(
      { sensitive: true, command: perm.command, executionId: perm.executionId, err },
      '[shell-permission] HITL request failed, aborting shell',
    );
    return pending.abort();
  }
}
