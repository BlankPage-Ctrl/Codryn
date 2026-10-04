import { AttachmentsDomainError } from './base.js';

export class StorageWriteError extends AttachmentsDomainError {
  constructor(resource: string, cause: unknown, details?: Record<string, unknown>) {
    super(
      'STORAGE_WRITE_FAILED',
      `Failed to write ${resource}`,
      {
        resource,
        cause: cause instanceof Error ? cause.message : String(cause),
        ...details,
      },
      500,
    );
  }
}

export class StorageReadError extends AttachmentsDomainError {
  constructor(resource: string, cause: unknown, details?: Record<string, unknown>) {
    super(
      'STORAGE_READ_FAILED',
      `Failed to read ${resource}`,
      {
        resource,
        cause: cause instanceof Error ? cause.message : String(cause),
        ...details,
      },
      500,
    );
  }
}
