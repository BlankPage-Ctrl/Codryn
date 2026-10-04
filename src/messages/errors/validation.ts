import { MessagesDomainError } from './base.js';

export class ValidationError extends MessagesDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}

export class InvalidInputError extends MessagesDomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_INPUT', message, details, 400);
  }
}
