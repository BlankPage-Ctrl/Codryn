import { RunDomainError } from './base.js';

export class RunNotFoundError extends RunDomainError {
  constructor(runId: string, details?: unknown) {
    super('RUN_NOT_FOUND', `Run not found: ${runId}`, details ?? { runId }, 404);
  }
}
