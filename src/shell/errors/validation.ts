import { ShellDomainError } from './base.js';

export class ValidationError extends ShellDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
