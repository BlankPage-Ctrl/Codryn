import { WorkspacesDomainError } from './base.js';

export class StorageWriteError extends WorkspacesDomainError {
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

export class StorageReadError extends WorkspacesDomainError {
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

export class ConflictError extends WorkspacesDomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, details, 409);
  }
}
