export const MESSAGE_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
  ASSEMBLER_ERROR: 400,
  INTERNAL_ERROR: 500,
} as const;

export type MessageErrorCode = keyof typeof MESSAGE_ERROR_STATUS_MAP;

export abstract class MessagesDomainError extends Error {
  public readonly code: MessageErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: MessageErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? MESSAGE_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
