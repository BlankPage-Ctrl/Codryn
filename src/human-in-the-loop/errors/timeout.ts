import { HitlDomainError } from './base.js';

// NOTE: the class name `TimeoutError` is part of the contract -
// `apps/actions/send.message.ts` detects waiter timeouts via `err.name`.
export class TimeoutError extends HitlDomainError {
  constructor(message: string, details?: unknown) {
    super('HITL_TIMEOUT', message, details, 408);
  }
}
