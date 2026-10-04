import { ShellDomainError } from './base.js';

/**
 * Infrastructure failure of the process executor itself (spawn errors,
 * permission errors, missing cwd, ...). A non-zero exit or timeout is NOT
 * an ExecutionError, the executor returns those as regular ExecOutput.
 */
export class ExecutionError extends ShellDomainError {
  constructor(cause: unknown, details?: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super('EXECUTION_FAILED', `Shell execution failed: ${message}`, details ?? { cause }, 500);
  }
}
