export const AUTH_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  INVALID_SIGNATURE: 401,
  TIMESTAMP_EXPIRED: 401,
  CLIENT_INACTIVE: 403,
  CLIENT_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_STATUS_MAP;

export abstract class AuthDomainError extends Error {
  public readonly code: AuthErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: AuthErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? AUTH_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
