export const WORKSPACE_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  WORKSPACE_NOT_FOUND: 404,
  NOT_FOUND: 404,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

export type WorkspaceErrorCode = keyof typeof WORKSPACE_ERROR_STATUS_MAP;

export abstract class WorkspacesDomainError extends Error {
  public readonly code: WorkspaceErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: WorkspaceErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? WORKSPACE_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
