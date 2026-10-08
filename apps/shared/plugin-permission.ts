import type { IHitlService } from '../../src/human-in-the-loop/index.js';

export interface PluginPermissionRequest {
  plugin: string;
  tool: string;
  sensitive: boolean;
  destructive: boolean;
  argsPreview: string;
}

export interface PluginPermissionResolverOptions {
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
 * HITL gate for plugin tool calls (mirrors `resolveMcpPermissionViaHitl`).
 *
 * - Non-sensitive tools auto-allow (no human round-trip, still logged by
 *   the caller). This is why sensitivity lives per tool, not per plugin:
 *   only sensitive tools interrupt the user.
 * - Sensitive (or destructive) tools ask once per call via `approval`.
 * - Deny/timeout/failure => deny (fail-closed for the individual call;
 *   the chat continues).
 */
export async function resolvePluginPermissionViaHitl(
  hitl: IHitlService,
  req: PluginPermissionRequest,
  options: PluginPermissionResolverOptions,
): Promise<'allow' | 'deny'> {
  if (!req.sensitive && !req.destructive) return 'allow';
  try {
    const request = await hitl.requestAndWait({
      type: 'approval',
      title: `Plugin approval: ${req.plugin}/${req.tool}`,
      description: req.destructive
        ? `The plugin "${req.plugin}" wants to run "${req.tool}" (marked destructive).`
        : `The plugin "${req.plugin}" wants to run "${req.tool}" (marked sensitive).`,
      chatId: options.chatId,
      workspaceId: options.workspaceId,
      executionId: options.toolCallId,
      timeoutMs: options.timeoutMs,
      metadata: { source: 'plugin', plugin: req.plugin, tool: req.tool },
      payload: {
        contextPreview: { plugin: req.plugin, tool: req.tool, arguments: req.argsPreview },
      },
    });
    if (request.type === 'approval' && isApproved(request.response?.outcome)) return 'allow';
    return 'deny';
  } catch {
    return 'deny';
  }
}
