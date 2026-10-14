import type { AgentsMdResult } from './types.js';

export function formatAgentsMdSection(loaded: AgentsMdResult | null): string | null {
  if (!loaded) return null;
  const body = loaded.truncated
    ? `${loaded.content}\n\n[truncated: ${loaded.source} exceeds the byte cap]`
    : loaded.content;
  return [`# Project context (from ${loaded.source})`, '', body].join('\n');
}
