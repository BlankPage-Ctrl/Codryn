import type { Container } from '../bootstrap.js';
import type { Workspace, WorkspaceCreateInput } from '../../src/workspaces/index.js';
import { ensureCodrynGitignored } from '../shared/ensure-gitignore.js';
import { ensureWorkspaceSettings } from '../shared/workspace-settings.js';

export async function createWorkspace(
  ctx: Container,
  params: WorkspaceCreateInput,
): Promise<Workspace> {
  const ws = await ctx.workspacesService.create(params);
  try {
    await ensureWorkspaceSettings(ctx, ws.id);
  } catch (err) {
    ctx.logger?.warn?.(
      { err, workspaceId: ws.id },
      'createWorkspace: ensureWorkspaceSettings failed',
    );
  }
  try {
    await ensureCodrynGitignored(ws.projectPath);
  } catch (err) {
    ctx.logger?.warn?.(
      { err, workspaceId: ws.id },
      'createWorkspace: ensureCodrynGitignored failed',
    );
  }
  return ws;
}
