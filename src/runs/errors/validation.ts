import { RunDomainError } from './base.js';

export class RunInvalidError extends RunDomainError {
  constructor(message: string, details?: unknown) {
    super('RUN_INVALID', message, details, 400);
  }
}
