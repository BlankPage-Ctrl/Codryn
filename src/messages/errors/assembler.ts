import { MessagesDomainError } from './base.js';

export class AssemblerError extends MessagesDomainError {
  constructor(message: string, details?: unknown) {
    super('ASSEMBLER_ERROR', message, details, 400);
  }
}
