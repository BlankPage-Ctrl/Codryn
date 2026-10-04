import { ChatDomainError } from './base.js';

export class ValidationError extends ChatDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
