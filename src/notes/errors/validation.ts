import { NotesDomainError } from './base.js';

export class ValidationError extends NotesDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
