import { NotesDomainError } from './base.js';

export class ConflictError extends NotesDomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, details, 409);
  }
}

export class AlreadyExistsError extends NotesDomainError {
  constructor(message: string, details?: unknown) {
    super('ALREADY_EXISTS', message, details, 409);
  }
}
