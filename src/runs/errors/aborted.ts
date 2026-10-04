import { RunDomainError } from './base.js';

export class RunAbortedError extends RunDomainError {
  constructor(runId: string, details?: unknown) {
    super('RUN_ABORTED', `Run aborted: ${runId}`, details ?? { runId }, 499);
  }
}
