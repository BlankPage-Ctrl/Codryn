export type ProviderErrorCode = 'PROVIDER_NOT_FOUND' | 'MODEL_NOT_FOUND' | 'VALIDATION_FAILED';

/** Domain error carrying a string `code` so apps/http error-handler maps it. */
export class ProviderDomainError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ProviderErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? (code.endsWith('NOT_FOUND') ? 404 : 400);
    if (details !== undefined) this.details = details;
  }
}

export class ProviderNotFoundError extends ProviderDomainError {
  constructor(id: string, details?: unknown) {
    super('PROVIDER_NOT_FOUND', `Provider not found: ${id}`, details ?? { id }, 404);
  }
}

export class ModelNotFoundError extends ProviderDomainError {
  constructor(id: string, details?: unknown) {
    super('MODEL_NOT_FOUND', `Model not found: ${id}`, details ?? { id }, 404);
  }
}

export class ProviderValidationError extends ProviderDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
