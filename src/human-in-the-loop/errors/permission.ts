import { HitlDomainError } from './base.js';

export class PermissionError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('FORBIDDEN', message, details, 403);
  }
}
