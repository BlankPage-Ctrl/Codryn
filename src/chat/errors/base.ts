export const CHAT_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  CHAT_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERROR_STATUS_MAP;

export abstract class ChatDomainError extends Error {
  public readonly code: ChatErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ChatErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? CHAT_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }

  /**
   * Backward compat alias for the legacy `errorCode` shape.
   * `apps/http/middleware/error-handler.ts` historically reads `err.errorCode`;
   * keep this in sync until all consumers read `code`.
   * @deprecated Use `code` instead.
   */
  get errorCode(): ChatErrorCode {
    return this.code;
  }
}
