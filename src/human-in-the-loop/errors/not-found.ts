import { HitlDomainError } from './base.js';

export class HitlRequestNotFoundError extends HitlDomainError {
  constructor(id: string, details?: unknown) {
    super('HITL_REQUEST_NOT_FOUND', `HITL request not found: ${id}`, details ?? { id }, 404);
  }
}
