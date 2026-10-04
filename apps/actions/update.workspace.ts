import type { Container } from '../bootstrap.js';
import type { Workspace, WorkspaceUpdateInput } from '../../src/workspaces/index.js';
import { NotFoundError, ValidationError, AppError } from '../shared/errors.js';
import { WorkspaceNotFoundError } from '../../src/workspaces/errors/not-found.js';
import { ValidationError as WorkspaceValidationError } from '../../src/workspaces/errors/validation.js';

export async function updateWorkspace(
  ctx: Container,
  params: { id: string; patch: WorkspaceUpdateInput },
): Promise<Workspace> {
  try {
    return await ctx.workspacesService.update(params.id, params.patch);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof WorkspaceValidationError) throw new ValidationError(err.message);
    if (err instanceof NotFoundError || err instanceof ValidationError || err instanceof AppError)
      throw err;
    throw err;
  }
}
