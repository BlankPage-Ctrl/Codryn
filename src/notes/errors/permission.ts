import { NotesDomainError } from './base.js';

export class PermissionError extends NotesDomainError {
  constructor(message: string, details?: unknown) {
    super('FORBIDDEN', message, details, 403);
  }
}
