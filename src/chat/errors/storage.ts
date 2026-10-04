import { ChatDomainError } from './base.js';

export class StorageWriteError extends ChatDomainError {
  constructor(resource: string, cause: unknown, details?: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      'STORAGE_WRITE_FAILED',
      `Storage write failed for ${resource}: ${message}`,
      details ?? { cause, resource },
      500,
    );
  }
}

export class StorageReadError extends ChatDomainError {
  constructor(resource: string, cause: unknown, details?: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      'STORAGE_READ_FAILED',
      `Storage read failed for ${resource}: ${message}`,
      details ?? { cause, resource },
      500,
    );
  }
}
