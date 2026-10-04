import { FmDomainError } from './base.js';

export class NotADirectoryError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('NOT_A_DIRECTORY', `Not a directory: "${pathLabel}"`, details, 400);
  }
}

export class NotAFileError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('NOT_A_FILE', `Not a file: "${pathLabel}"`, details, 400);
  }
}

export class PermissionDeniedError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('PERMISSION_DENIED', `Permission denied: "${pathLabel}"`, details, 403);
  }
}

export class FileTooLargeError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('FILE_TOO_LARGE', `File too large: "${pathLabel}"`, details, 413);
  }
}

export class StorageWriteError extends FmDomainError {
  constructor(message: string, details?: unknown) {
    super('INTERNAL_ERROR', message, details, 500);
  }
}

export class StorageReadError extends FmDomainError {
  constructor(pathLabel: string, cause?: unknown) {
    super('INTERNAL_ERROR', `Filesystem error: "${pathLabel}"`, cause, 500);
  }
}

export class AlreadyExistsError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('ALREADY_EXISTS', `Already exists: "${pathLabel}"`, details, 409);
  }
}
