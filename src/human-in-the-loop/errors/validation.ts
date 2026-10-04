import { HitlDomainError } from './base.js';

export class ValidationError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
