import { HitlDomainError } from './base.js';

export class ConflictError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, details, 409);
  }
}
