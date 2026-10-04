import { HitlDomainError } from './base.js';

export class InvariantError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('INTERNAL_ERROR', message, details, 500);
  }
}
