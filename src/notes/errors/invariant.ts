import { NotesDomainError } from './base.js';

export class InvariantError extends NotesDomainError {
  constructor(message: string, details?: unknown) {
    super('INTERNAL_ERROR', message, details, 500);
  }
}
