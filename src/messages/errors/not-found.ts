import { MessagesDomainError } from './base.js';

export class NotFoundError extends MessagesDomainError {
  constructor(resource: string, id: string, details?: unknown) {
    super('NOT_FOUND', `${resource} with id ${id} not found`, details, 404);
  }
}
