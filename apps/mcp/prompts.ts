import type { McpManager, McpWorkspaceSnapshot } from './manager.js';

export interface McpPromptCommand {
  /** `mcp:<server>/<prompt>` - namespaced so it never collides with skills. */
  command: string;
  server: string;
  name: string;
  description: string;
}

/**
 * STABLE but NOT wired to production: expose MCP prompts as user-picked
 * commands (data only - never as `AgentTool`, the model must not invoke
 * prompts autonomously per spec: prompts are user-controlled).
 */
export function listMcpPromptCommands(snapshot: McpWorkspaceSnapshot): McpPromptCommand[] {
  return snapshot.prompts.map((p) => ({
    command: `mcp:${p.server}/${p.name}`,
    server: p.server,
    name: p.name,
    description: p.description?.trim() || `MCP prompt ${p.name} from ${p.server}.`,
  }));
}

/** Fetch + render one prompt (user explicitly picked it). */
export async function getMcpPromptText(
  snapshot: McpWorkspaceSnapshot,
  manager: Pick<McpManager, 'getPrompt'>,
  server: string,
  name: string,
  args?: Record<string, unknown>,
): Promise<string> {
  return manager.getPrompt(snapshot.workspaceId, snapshot.projectPath, server, name, args);
}
