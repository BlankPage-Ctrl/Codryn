import type { FmError, FmMeta, FmSuccess } from '../types/index.js';
import type { ErrorCode } from '../types/error-codes.js';
import { ERROR_STATUS_MAP } from '../errors/base.js';
import { FmDomainError } from '../errors/base.js';

interface NodeError extends Error {
  code?: string;
}

export function ok<T>(data: T, meta?: FmMeta): FmSuccess<T> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function fail(code: ErrorCode, message: string, details?: unknown): FmError {
  const statusCode = ERROR_STATUS_MAP[code];
  if (details === undefined) {
    return { success: false, error: { code, message, statusCode } };
  }
  return { success: false, error: { code, message, statusCode, details } };
}

export function mapFsError(error: unknown, fallbackCode: ErrorCode, pathLabel: string): FmError {
  // If already a domain error (e.g. PathTraversalError, EditFailedError, NotAFileError), propagate with full context
  if (error instanceof FmDomainError) {
    return fail(
      error.code,
      error.message,
      error.details ?? (error as unknown as { details?: unknown }).details,
    );
  }

  const nodeError = error as NodeError;
  switch (nodeError.code) {
    case 'ENOENT':
      return fail('PATH_NOT_FOUND', `Path not found: "${pathLabel}"`);
    case 'EACCES':
    case 'EPERM':
      return fail('PERMISSION_DENIED', `Permission denied: "${pathLabel}"`);
    case 'ENOTDIR':
      return fail('NOT_A_DIRECTORY', `Not a directory: "${pathLabel}"`);
    default:
      return fail(fallbackCode, nodeError.message || `Filesystem error: "${pathLabel}"`);
  }
}
