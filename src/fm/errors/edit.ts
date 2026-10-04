import { FmDomainError } from './base.js';
import type { EditFailureDetails } from '../types/edit.js';

export class EditFailedError extends FmDomainError {
  declare details: EditFailureDetails;

  constructor(details: EditFailureDetails) {
    super('EDIT_FAILED', details.reason, details, 422);
  }

  get editDetails(): EditFailureDetails {
    return this.details;
  }
}
