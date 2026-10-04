import { FmDomainError } from './base.js';

export class PathNotFoundError extends FmDomainError {
  constructor(pathLabel: string, details?: unknown) {
    super('PATH_NOT_FOUND', `Path not found: "${pathLabel}"`, details, 404);
  }
}

export class WorkspaceNotFoundError extends FmDomainError {
  constructor(workspaceRoot: string, details?: unknown) {
    super('WORKSPACE_NOT_FOUND', `Workspace not found: "${workspaceRoot}"`, details, 404);
  }
}

export class NotFoundError extends FmDomainError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, details, 404);
  }
}
