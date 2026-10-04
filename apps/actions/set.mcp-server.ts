import { NotFoundError } from '../shared/errors.js';
import { McpError } from '../mcp/client.js';
import type { McpServerState } from '../mcp/manager.js';
import { resolveMcpProjectPath, type McpServerActionCtx } from './list.mcp-server.js';

export interface SetMcpServerEnabledParams {
  workspaceId: string;
  name: string;
  enabled: boolean;
}

export interface SetMcpServerEnabledResult {
  workspaceId: string;
  server: McpServerState;
}

export async function setMcpServerEnabled(
  ctx: McpServerActionCtx,
  params: SetMcpServerEnabledParams,
): Promise<SetMcpServerEnabledResult> {
  const projectPath = await resolveMcpProjectPath(ctx, params.workspaceId);
  try {
    const server = await ctx.mcpManager.setServerEnabled(
      params.workspaceId,
      projectPath,
      params.name,
      params.enabled,
    );
    return { workspaceId: params.workspaceId, server };
  } catch (err) {
    if (err instanceof McpError && err.code === 'MCP_SERVER_NOT_FOUND') {
      throw new NotFoundError(err.message);
    }
    throw err;
  }
}
