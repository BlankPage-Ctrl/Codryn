import { WorkspacesDomainError } from './base.js';

export class WorkspaceNotFoundError extends WorkspacesDomainError {
  constructor(id: string, details?: unknown) {
    super('WORKSPACE_NOT_FOUND', `Workspace not found: ${id}`, details ?? { id }, 404);
  }
}
