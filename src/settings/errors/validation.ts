import { SettingsDomainError } from './base.js';

export class ValidationError extends SettingsDomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}
