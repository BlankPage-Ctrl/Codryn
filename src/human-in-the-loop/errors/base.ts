export const HITL_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  FORBIDDEN: 403,
  HITL_REQUEST_NOT_FOUND: 404,
  CONFLICT: 409,
  HITL_CANCELLED: 409,
  HITL_TIMEOUT: 408,
  INTERNAL_ERROR: 500,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
} as const;

export type HitlErrorCode = keyof typeof HITL_ERROR_STATUS_MAP;

export abstract class HitlDomainError extends Error {
  public readonly code: HitlErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: HitlErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? HITL_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
