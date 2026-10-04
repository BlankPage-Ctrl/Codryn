export const ATTACHMENT_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
  INTERNAL_ERROR: 500,
} as const;

export type AttachmentErrorCode = keyof typeof ATTACHMENT_ERROR_STATUS_MAP;

export abstract class AttachmentsDomainError extends Error {
  public readonly code: AttachmentErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: AttachmentErrorCode,
    message: string,
    details?: unknown,
    statusCode?: number,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? ATTACHMENT_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
