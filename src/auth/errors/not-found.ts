import { AuthDomainError } from './base.js';

export class ClientNotFoundError extends AuthDomainError {
  constructor(identifier: string, details?: unknown) {
    super('CLIENT_NOT_FOUND', `Client not found: ${identifier}`, details ?? { identifier }, 404);
  }
}
