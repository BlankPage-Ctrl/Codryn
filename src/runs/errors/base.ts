export const RUN_ERROR_STATUS_MAP = {
  RUN_NOT_FOUND: 404,
  RUN_ABORTED: 499,
  RUN_INVALID: 400,
  INTERNAL_ERROR: 500,
} as const;

export type RunErrorCode = keyof typeof RUN_ERROR_STATUS_MAP;

export abstract class RunDomainError extends Error {
  public readonly code: RunErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: RunErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? RUN_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
