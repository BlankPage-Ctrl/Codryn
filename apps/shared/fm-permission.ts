import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { FmPendingApproval, FmPermissionInput, FmResult } from '../../src/fm/index.js';
import { addFmAlwaysAllowed, fmAlwaysKey, isFmAlwaysAllowed } from './fm-always-allow.js';
import type { Logger } from './types.js';


/**
 * Built-in risky-file patterns.
 * Forms: exact/wildcard file name (`.env`, `*.pem`), `dir/` for any path
 * segment, and `!` to negate an earlier match.
 */
export const SENSITIVE_FILE_PATTERNS = new Set([
  // Environment files and package-manager credentials.
  '.env',
  '.env.*',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.htpasswd',
  '.git-credentials',
  // SSH and TLS private material.
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.p8',
  '*.keystore',
  '*.jks',
  '*.ppk',
  '*.kdbx',
  // Cloud / tool credential stores.
  'credentials',
  'secrets',
  'secret',
  '.ssh/',
  '.aws/',
  '.gnupg/',
  '.kube/',
  // Templates carry no secret.
  '!.env.example',
  '!.env.sample',
  '!.env.template',
  '!.env.dist',
]);

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
  const sensitive = perm.sensitive === true;

  // Sensitive reads always prompt; a previously approved directory must not
  // silently cover a credential file inside it.
  if (!sensitive && key && paths.every((p) => isFmAlwaysAllowed(key, p))) {
    return pending.confirm({ decision: 'allow' });
  }

  try {
    const request = await hitl.requestAndWait({
      type: 'approval',
      title:
        typeof options.title === 'function'
          ? options.title(perm)
          : (options.title ??
            (sensitive
              ? `Sensitive file approval: ${perm.requestedPath}`
              : `Read File approval: ${perm.requestedPath}`)),
      description:
        options.description?.(perm) ??
        (sensitive
          ? `Sensitive file read requires approval.\n` +
            `Target: ${perm.absolutePath}\n` +
            `Workspace: ${perm.workspaceRoot}`
          : `Read-only ${perm.operation} outside the workspace.\n` +
            `Target: ${perm.absolutePath}\n` +
            `Workspace: ${perm.workspaceRoot}` +
            (perm.viaSymlink ? `\nReached via symlink: ${perm.symlinkPath ?? '(unknown)'}` : '')),
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
        sensitive,
        reason: perm.reason ?? (sensitive ? 'sensitive-file' : 'outside-workspace'),
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
          sensitive,
          reason: perm.reason ?? (sensitive ? 'sensitive-file' : 'outside-workspace'),
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
      if (request.response?.outcome === 'always_approved' && key && !sensitive) {
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
