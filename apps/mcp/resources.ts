import type { McpManager, McpWorkspaceSnapshot } from './manager.js';

export interface McpResourcePart {
  type: 'text';
  text: string;
  isSystem: true;
}

/**
 * Format a resource body for model context (Markdown-first, trimmed).
 * Mirrors the `formatToolOutput` principle in `apps/Structure.md`.
 */
export function formatResourceForModel(uri: string, text: string, mimeType?: string): string {
  const head =
    mimeType && !mimeType.startsWith('text/')
      ? `# Resource \`${uri}\` (${mimeType})`
      : `# Resource \`${uri}\``;
  let body = text.trim() || '_(empty resource)_';
  if (body.length > 8_000) {
    body = `${body.slice(0, 8_000)}\n\n_(truncated, ${body.length - 8_000} chars omitted)_`;
  }
  return `${head}\n\n${body}`;
}

/**
 * STABLE but NOT wired to production: build system-context parts from a
 * snapshot's resource list. The application (not the model) decides what is
 * included - callers must pass an explicit `pick` filter; without it nothing
 * is injected (no surprise context cost).
 */
export async function buildResourceSystemParts(
  snapshot: McpWorkspaceSnapshot,
  manager: Pick<McpManager, 'readResource'>,
  pick: (uri: string, server: string) => boolean = () => false,
): Promise<McpResourcePart[]> {
  const parts: McpResourcePart[] = [];
  for (const res of snapshot.resources) {
    if (!pick(res.uri, res.server)) continue;
    try {
      const text = await manager.readResource(
        snapshot.workspaceId,
        snapshot.projectPath,
        res.server,
        res.uri,
      );
      parts.push({
        type: 'text',
        text: formatResourceForModel(res.uri, text, res.mimeType),
        isSystem: true,
      });
    } catch {
      // One bad resource never breaks the batch.
    }
  }
  return parts;
}
