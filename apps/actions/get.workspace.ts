import type { Container } from '../bootstrap.js';
import type { Workspace } from '../../src/workspaces/index.js';
import { NotFoundError, ValidationError, AppError } from '../shared/errors.js';
import { WorkspaceNotFoundError } from '../../src/workspaces/errors/not-found.js';
import { ValidationError as WorkspaceValidationError } from '../../src/workspaces/errors/validation.js';

export async function getWorkspace(ctx: Container, params: { id: string }): Promise<Workspace> {
  try {
    return await ctx.workspacesService.findOne(params.id);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof WorkspaceValidationError) throw new ValidationError(err.message);
    if (err instanceof NotFoundError || err instanceof ValidationError || err instanceof AppError)
      throw err;
    throw err;
  }
}
