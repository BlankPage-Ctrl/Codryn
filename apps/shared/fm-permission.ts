import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { FmPendingApproval, FmPermissionInput, FmResult } from '../../src/fm/index.js';
import { addFmAlwaysAllowed, fmAlwaysKey, isFmAlwaysAllowed } from './fm-always-allow.js';
import type { Logger } from './types.js';

export interface FmPermissionResolverOptions {
  workspaceId?: string | null;
  chatId?: string | null;
  toolCallId?: string;
  title?: string | ((perm: FmPermissionInput) => string);
  description?: (perm: FmPermissionInput) => string | undefined;
  correlationId?: string;
  timeoutMs?: number;
  requireReasonOnReject?: boolean;
  /** Optional logger (file-backed). Falls back to console (captured by the console bridge). */
  logger?: Logger;
}

/**
 * Tool-side resolver: called with an `FmPendingApproval` plus the current
 * toolCallId, asks HITL and invokes `pending.confirm`/`abort`. Mirrors
 * `resolveShellPermissionViaHitl` - the fast path here is the RAM-only
 * per-chat always-allow store instead of the workspace TOML policy.
 */
export type FmPermissionResolver<T> = (
  pending: FmPendingApproval<T>,
  toolCallId?: string,
) => Promise<FmResult<T>>;

function isApproved(outcome: string | undefined): boolean {
  return outcome === 'approved' || outcome === 'always_approved';
}

export async function resolveFmPermissionViaHitl<T>(
  hitl: IHitlService,
  pending: FmPendingApproval<T>,
  options: FmPermissionResolverOptions = {},
): Promise<FmResult<T>> {
  const perm = pending.permission;
  const log: Logger = options.logger ?? console;
  const key = fmAlwaysKey(options.workspaceId, options.chatId);
  const paths =
    perm.outsidePaths && perm.outsidePaths.length > 0 ? perm.outsidePaths : [perm.absolutePath];

  if (key && paths.every((p) => isFmAlwaysAllowed(key, p))) {
    return pending.confirm({ decision: 'allow' });
  }

  try {
    const request = await hitl.requestAndWait({
      type: 'approval',
      title:
        typeof options.title === 'function'
          ? options.title(perm)
          : (options.title ?? `Read File approval: ${perm.requestedPath}`),
      description:
        options.description?.(perm) ??
        `Read-only ${perm.operation} outside the workspace.\n` +
          `Target: ${perm.absolutePath}\n` +
          `Workspace: ${perm.workspaceRoot}` +
          (perm.viaSymlink ? `\nReached via symlink: ${perm.symlinkPath ?? '(unknown)'}` : ''),
      correlationId: options.correlationId,
      timeoutMs: options.timeoutMs,
      workspaceId: options.workspaceId ?? undefined,
      chatId: options.chatId ?? '',
      executionId: options.toolCallId ?? undefined,
      metadata: {
        source: 'fm',
        operation: perm.operation,
        requestedPath: perm.requestedPath,
        absolutePath: perm.absolutePath,
        workspaceRoot: perm.workspaceRoot,
        viaSymlink: perm.viaSymlink,
      },
      payload: {
        contextPreview: {
          operation: perm.operation,
          requestedPath: perm.requestedPath,
          absolutePath: perm.absolutePath,
          workspaceRoot: perm.workspaceRoot,
          viaSymlink: perm.viaSymlink,
          symlinkPath: perm.symlinkPath ?? null,
          outsidePaths: paths,
        },
        requireReasonOnReject: options.requireReasonOnReject,
      },
    });

    if (request.type === 'approval' && request.response?.outcome === 'approved_with_modification') {
      log.warn(
        {
          sensitive: true,
          operation: perm.operation,
          requestedPath: perm.requestedPath,
          absolutePath: perm.absolutePath,
        },
        '[fm-permission] approved_with_modification is unsupported, aborting',
      );
      return pending.abort();
    }

    if (request.type === 'approval' && isApproved(request.response?.outcome)) {
      if (request.response?.outcome === 'always_approved' && key) {
        // Stored verbatim as directory-prefix entries: approving a directory
        // covers its subtree for this chat; approving a file covers just it.
        for (const p of paths) {
          try {
            addFmAlwaysAllowed(key, p);
          } catch (err) {
            log.warn(
              { sensitive: true, absolutePath: p, key, err },
              '[fm-permission] failed to record always_approved path',
            );
          }
        }
      }
      return pending.confirm({
        decision: 'allow',
        reason: (request.response as { reason?: string })?.reason,
      });
    }
    return pending.abort();
  } catch (err) {
    log.warn(
      {
        sensitive: true,
        operation: perm.operation,
        requestedPath: perm.requestedPath,
        absolutePath: perm.absolutePath,
        err,
      },
      '[fm-permission] HITL request failed, aborting file access',
    );
    return pending.abort();
  }
}
