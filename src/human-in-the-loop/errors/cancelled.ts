import { HitlDomainError } from './base.js';

export class CancelledError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('HITL_CANCELLED', message, details, 409);
  }
}
