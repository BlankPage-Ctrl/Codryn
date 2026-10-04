import { AuthDomainError } from './base.js';

/**
 * Structured vocabulary for authentication-check failures.
 *
 * NOTE: `verifySignature` returns these as Result reasons (`VerifySignatureResult.code`),
 * not as thrown errors - auth failure is an expected outcome the middleware maps to 401.
 * These classes exist so any future throw-style verification path throws the same way
 * as the rest of the domain (Structure.md rule 4: all layers throw the same way).
 */
export class InvalidSignatureError extends AuthDomainError {
  constructor(reason: string, details?: unknown) {
    super('INVALID_SIGNATURE', `Invalid signature: ${reason}`, details ?? { reason }, 401);
  }
}

export class ClientInactiveError extends AuthDomainError {
  constructor(clientId: string, details?: unknown) {
    super('CLIENT_INACTIVE', `Client is inactive: ${clientId}`, details ?? { clientId }, 403);
  }
}

export class TimestampExpiredError extends AuthDomainError {
  constructor(details?: unknown) {
    super('TIMESTAMP_EXPIRED', 'Request timestamp has expired (max 5 minutes)', details, 401);
  }
}
