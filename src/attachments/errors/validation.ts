import { AttachmentsDomainError } from './base.js';

export class ValidationError extends AttachmentsDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
