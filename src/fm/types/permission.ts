import { fail } from '../utils/result.js';
import type { AbsolutePath, FmError, FmResult } from './index.js';

export type FmOperation = 'read' | 'list' | 'stat' | 'search' | 'grep';

export interface FmPermissionInput {
  operation: FmOperation;
  /** workspace-relative or absolute */
  requestedPath: string;
  /** Resolved absolute target outside the workspace. */
  absolutePath: AbsolutePath;
  workspaceRoot: AbsolutePath;
  /** True when the escape happens via a symlink (incl. ancestor dirs). */
  viaSymlink: boolean;
  /** The symlink path that escapes, when `viaSymlink` is true. */
  symlinkPath?: string;
  /** All outside absolute roots for multi-root ops (grep folders/files). */
  outsidePaths?: AbsolutePath[];
}

export type FmPermissionDecision = 'allow' | 'deny';

export interface FmPermissionConfirmation {
  decision: FmPermissionDecision;
  reason?: string;
}

export type FmPermissionCallback<T> = (
  confirmation: FmPermissionConfirmation,
) => Promise<FmResult<T>>;

/**
 * Shell-style pending approval for FM. Structurally an `FmError` (code
 * `REQUIRES_APPROVAL`) so existing callers that only read
 * `success`/`error`/`data` keep compiling and behave as a denial - only
 * callers that opt in via `isFmPendingApproval` + a resolver trigger HITL.
 *
 * The guarded operation has NOT touched the filesystem yet (outside-string
 * paths never get FS access before approval; inside-string paths only got
 * best-effort `lstat`/`readlink` probes, never content reads).
 */
export interface FmPendingApproval<T = unknown> {
  success: false;
  error: {
    code: 'REQUIRES_APPROVAL';
    message: string;
    statusCode: number;
    details: {
      requiresApproval: true;
      operation: FmOperation;
      requestedPath: string;
      absolutePath: AbsolutePath;
    };
  };
  permission: FmPermissionInput;
  confirm: FmPermissionCallback<T>;
  abort: () => Promise<FmError>;
}

export type FmOutcome<T> = FmResult<T> | FmPendingApproval<T>;

export function isFmPendingApproval<T>(
  result: FmOutcome<T> | FmResult<T>,
): result is FmPendingApproval<T> {
  return (
    !result.success &&
    (result.error as { code?: string }).code === 'REQUIRES_APPROVAL' &&
    'permission' in result &&
    typeof (result as FmPendingApproval<T>).confirm === 'function'
  );
}

export function createFmPendingApproval<T>(
  permission: FmPermissionInput,
  executor: () => Promise<FmResult<T>>,
): FmPendingApproval<T> {
  const denied = (why: string): FmError =>
    fail(
      'PERMISSION_DENIED',
      `Outside-workspace ${permission.operation} rejected (${why}): "${permission.requestedPath}"`,
      { operation: permission.operation, absolutePath: permission.absolutePath },
    );
  return {
    success: false,
    error: {
      code: 'REQUIRES_APPROVAL',
      message:
        `Path is outside the workspace: "${permission.requestedPath}" ` +
        `(resolves to "${permission.absolutePath}") - requires user approval`,
      statusCode: 403,
      details: {
        requiresApproval: true as const,
        operation: permission.operation,
        requestedPath: permission.requestedPath,
        absolutePath: permission.absolutePath,
      },
    },
    permission,
    confirm: async (confirmation) => {
      if (confirmation.decision !== 'allow') return denied('denied by approver');
      return executor();
    },
    abort: async () => denied('approval aborted'),
  };
}
