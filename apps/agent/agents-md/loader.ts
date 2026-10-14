import type { AgentsMdLogger, AgentsMdPort, AgentsMdResult, AgentsMdSource } from './types.js';

const CANDIDATES: AgentsMdSource[] = ['AGENTS.md', 'CLAUDE.md'];

// AGENTS.md wins, CLAUDE.md is the fallback. Missing files resolve to null.
export async function loadAgentsMdForWorkspace(
  port: AgentsMdPort,
  logger?: AgentsMdLogger,
): Promise<AgentsMdResult | null> {
  for (const source of CANDIDATES) {
    let file;
    try {
      file = await port.readFile(source);
    } catch (err) {
      logger?.warn({ err, source }, 'agents-md read failed');
      continue;
    }
    if (file == null) continue;
    const content = file.content.trim();
    if (content.length === 0) continue;
    if (file.truncated) {
      logger?.warn({ source, root: port.root }, 'agents-md truncated to byte cap');
    }
    return { source, content, truncated: file.truncated };
  }
  return null;
}
