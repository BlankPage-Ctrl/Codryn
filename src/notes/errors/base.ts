export const NOTE_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  NOTE_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
} as const;

export type NoteErrorCode = keyof typeof NOTE_ERROR_STATUS_MAP;

export abstract class NotesDomainError extends Error {
  public readonly code: NoteErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: NoteErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? NOTE_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
