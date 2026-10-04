import { escTick } from './shared.js';

export function formatInsightNotFound(id: string): string {
  return `**Error**: \`INSIGHT_ENTRY_NOT_FOUND\` - entry ID not found: \`${escTick(id)}\`\n**Suggestion**: Use insight search to find a valid id, then call \`insight_graph\` with the ID.`;
}

export function formatInsightError(code: string, message: string, id?: string): string {
  const where = id ? ` ('${escTick(id)}')` : '';
  return `Error [${code}]: ${message}${where}`;
}
