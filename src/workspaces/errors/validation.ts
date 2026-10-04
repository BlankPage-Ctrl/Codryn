import { WorkspacesDomainError } from './base.js';

export class ValidationError extends WorkspacesDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
