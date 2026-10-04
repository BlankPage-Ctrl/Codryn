import type { IHitlService } from '../../src/human-in-the-loop/index.js';

export interface McpPermissionRequest {
  server: string;
  tool: string;
  readOnly: boolean;
  destructive: boolean;
  argsPreview: string;
}

export interface McpPermissionResolverOptions {
  workspaceId: string;
  chatId: string;
  toolCallId?: string;
  timeoutMs?: number;
}

function isApproved(outcome: string | undefined): boolean {
  return (
    outcome === 'approved' ||
    outcome === 'always_approved' ||
    outcome === 'approved_with_modification'
  );
}

/**
 * HITL gate for MCP tool calls (mirrors `resolveShellPermissionViaHitl`).
 *
 * - Read-only tools auto-allow (no human round-trip).
 * - Everything else asks once per call via `approval`. Deny/timeout/failure
 *   => deny (fail-closed for the individual call; the chat continues).
 */
export async function resolveMcpPermissionViaHitl(
  hitl: IHitlService,
  req: McpPermissionRequest,
  options: McpPermissionResolverOptions,
): Promise<'allow' | 'deny'> {
  if (req.readOnly && !req.destructive) return 'allow';
  try {
    const request = await hitl.requestAndWait({
      type: 'approval',
      title: `MCP approval: ${req.server}/${req.tool}`,
      description: req.destructive
        ? `The MCP server "${req.server}" wants to run "${req.tool}" (marked destructive).`
        : `The MCP server "${req.server}" wants to run "${req.tool}".`,
      chatId: options.chatId,
      workspaceId: options.workspaceId,
      executionId: options.toolCallId,
      timeoutMs: options.timeoutMs,
      metadata: { source: 'mcp', server: req.server, tool: req.tool },
      payload: {
        contextPreview: { server: req.server, tool: req.tool, arguments: req.argsPreview },
      },
    });
    if (request.type === 'approval' && isApproved(request.response?.outcome)) return 'allow';
    return 'deny';
  } catch {
    return 'deny';
  }
}
