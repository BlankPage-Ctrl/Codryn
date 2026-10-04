import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import type { McpServerState } from '../mcp/manager.js';

export interface ListMcpServersParams {
  workspaceId: string;
}

export interface ListMcpServersResult {
  workspaceId: string;
  source: string | null;
  servers: McpServerState[];
}

export type McpServerActionCtx = Pick<Container, 'workspacesService' | 'mcpManager' | 'logger'>;

export async function resolveMcpProjectPath(
  ctx: McpServerActionCtx,
  workspaceId: string,
): Promise<string> {
  const ws = await ctx.workspacesService.findOne(workspaceId);
  if (!ws) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  return ws.projectPath;
}

export async function listMcpServers(
  ctx: McpServerActionCtx,
  params: ListMcpServersParams,
): Promise<ListMcpServersResult> {
  const projectPath = await resolveMcpProjectPath(ctx, params.workspaceId);
  const states = await ctx.mcpManager.getServerStates(params.workspaceId, projectPath);
  return { workspaceId: params.workspaceId, source: states.source, servers: states.servers };
}
