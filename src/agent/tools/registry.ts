import { tool, type ToolSet } from 'ai';
import type { AgentTool } from '../types/index.js';

export function buildToolset(tools: AgentTool[]): ToolSet {
  const record: Record<string, unknown> = {};
  for (const definition of tools) {
    record[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: definition.execute as never,
    });
  }
  return record as ToolSet;
}
