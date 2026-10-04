import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import { insightGraph } from '../../insight/index.js';
import {
  InsightDisabledError,
  InsightEntryNotFoundError,
  InsightSyncThrottledError,
} from '../../insight/execute/errors.js';
import {
  DEFAULT_GRAPH_REF_LIMIT,
  MAX_GRAPH_REF_LIMIT,
  formatInsightGraph,
  formatInsightNotFound,
} from '../../insight/format/index.js';
import type { InsightGraph, InsightSettingsPort } from '../../insight/types.js';
import { truncateToolOutput } from '../utils/truncate.js';

export const insightGraphSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('Node id from insight_search hit (e.g. func:MyFunc@src/foo.ts:10-20)'),
  refLimit: z
    .number()
    .int()
    .positive()
    .max(MAX_GRAPH_REF_LIMIT)
    .default(DEFAULT_GRAPH_REF_LIMIT)
    .describe(
      `Per-section cap for calls/calledBy/paramTypes etc. Default ${DEFAULT_GRAPH_REF_LIMIT}, capped at ${MAX_GRAPH_REF_LIMIT}`,
    ),
  includeScopes: z
    .array(z.enum(['internal', 'external', 'unresolved']))
    .optional()
    .describe('Filter refs by scope prefix; default all'),
  compact: z
    .boolean()
    .default(true)
    .describe('Compact hides edge table & truncates doc/signature; default true'),
  kinds: z
    .array(z.enum(['calls', 'extends', 'implements', 'param', 'return', 'uses']))
    .optional()
    .describe('Edge kinds filter; default all'),
});

export type InsightGraphToolDeps = {
  workspaceId: string;
  projectPath: string;
  settings: InsightSettingsPort;
};

function mapInsightGraphError(err: unknown, id?: string): string {
  const code = (err as { code?: string })?.code;

  if (err instanceof InsightEntryNotFoundError || code === 'INSIGHT_ENTRY_NOT_FOUND') {
    const target =
      id ??
      (typeof (err as { message?: string })?.message === 'string'
        ? String((err as { message?: string }).message)
            .split(':')
            .pop()
            ?.trim()
        : undefined);
    return formatInsightNotFound(target ?? id ?? 'unknown');
  }
  if (err instanceof InsightDisabledError || code === 'INSIGHT_DISABLED') {
    return `**Error**: Insight is disabled for this workspace.\n**Suggestion**: Insight graph is not available right now.`;
  }
  if (err instanceof InsightSyncThrottledError || code === 'INSIGHT_SYNC_THROTTLED') {
    return `**Error**: Insight is temporarily busy.\n**Suggestion**: Insight Index maybe syncing. Try again later or use other tools for now.`;
  }
  return `**Error**: Insight is temporarily unavailable.\n**Suggestion**: The code index is not ready. Try again later or use other tools to view the file directly.`;
}

async function guardGraphOutput(content: string, projectPath: string): Promise<string> {
  if (content.length === 0) return content;
  try {
    const guarded = await truncateToolOutput({
      content,
      projectPath,
      toolName: 'insight_graph',
      mode: 'head',
    });
    return guarded.text;
  } catch {
    return content;
  }
}

export function createInsightGraphTool(deps: InsightGraphToolDeps): AgentTool[] {
  const tool: AgentTool<typeof insightGraphSchema> = {
    name: 'insight_graph',
    description:
      'Show the 1-hop dependency graph for a symbol ID (calls, callers, type relations); Great for understanding code flow and relationships. Use `insight_search` to find IDs.',
    inputSchema: insightGraphSchema,
    execute: async ({
      id,
      refLimit,
      includeScopes,
      compact,
      kinds,
    }: z.infer<typeof insightGraphSchema>) => {
      try {
        const graph: InsightGraph = await insightGraph(
          { workspaceId: deps.workspaceId, settings: deps.settings },
          { id, kinds },
        );
        const text = formatInsightGraph(graph, { refLimit, includeScopes, compact });
        return await guardGraphOutput(text, deps.projectPath);
      } catch (err) {
        const formatted = mapInsightGraphError(err, id);
        return await guardGraphOutput(formatted, deps.projectPath);
      }
    },
  };

  return [tool];
}
