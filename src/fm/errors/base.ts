import type { ErrorCode } from '../types/error-codes.js';

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOKEN_EXPIRED: 401,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PATH_NOT_FOUND: 404,
  PATH_TRAVERSAL: 403,
  REQUIRES_APPROVAL: 403,
  NOT_A_DIRECTORY: 400,
  NOT_A_FILE: 400,
  PERMISSION_DENIED: 403,
  FILE_TOO_LARGE: 413,
  WORKSPACE_NOT_FOUND: 404,
  EDIT_FAILED: 422,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export abstract class FmDomainError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
