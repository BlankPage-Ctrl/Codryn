import type { Container } from '../bootstrap.js';
import type { Workspace } from '../../src/workspaces/index.js';

export async function listWorkspaces(ctx: Container): Promise<Workspace[]> {
  return ctx.workspacesService.findAll();
}
