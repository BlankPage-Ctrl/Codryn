import { AuthDomainError } from './base.js';

export class ValidationError extends AuthDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
