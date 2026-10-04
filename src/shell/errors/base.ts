export const SHELL_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  EXECUTION_FAILED: 500,
  INTERNAL_ERROR: 500,
} as const;

export type ShellErrorCode = keyof typeof SHELL_ERROR_STATUS_MAP;

export abstract class ShellDomainError extends Error {
  public readonly code: ShellErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ShellErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? SHELL_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
