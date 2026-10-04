import { NotesDomainError } from './base.js';

export class NotFoundError extends NotesDomainError {
  constructor(id: string, details?: unknown) {
    super('NOT_FOUND', `Not found: ${id}`, details ?? { id }, 404);
  }
}

export class NoteNotFoundError extends NotesDomainError {
  constructor(id: string, details?: unknown) {
    super('NOTE_NOT_FOUND', `Note not found: ${id}`, details ?? { id }, 404);
  }
}

export class CategoryNotFoundError extends NotesDomainError {
  constructor(id: string, details?: unknown) {
    super('CATEGORY_NOT_FOUND', `Category not found: ${id}`, details ?? { id }, 404);
  }
}
