import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import { insightSearch } from '../../insight/index.js';
import { InsightDisabledError, InsightSyncThrottledError } from '../../insight/execute/errors.js';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  formatInsightSearchWithCode,
  type RenderCodeReader,
} from '../../insight/format/index.js';
import type { InsightSearchResult, InsightSettingsPort } from '../../insight/types.js';
import { truncateToolOutput } from '../utils/truncate.js';

const MAX_SEARCH_FILES = 15;
const MAX_SEARCH_VISIBLE_CHARS = 20000;
const MAX_SEARCH_VISIBLE_LINES = 250;

export const insightSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'Search query — symbol/function/type name; query bag of symbols, whitespace, comma, or semicolon separated, capped at 32',
    ),
  mode: z
    .enum(['auto', 'exact', 'prefix', 'substring', 'fts'])
    .default('auto')
    .describe('Search mode; auto is recommended'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_SEARCH_LIMIT)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(`Max hits shown; defaults to ${DEFAULT_SEARCH_LIMIT}, capped at ${MAX_SEARCH_LIMIT}`),
  file: z.string().trim().max(500).optional().describe('Filter by file path substring'),
  container: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Filter by container/class name substring'),
  maxFiles: z
    .number()
    .int()
    .positive()
    .max(MAX_SEARCH_FILES)
    .optional()
    .describe(
      `Max files rendered in the code section; defaults to tier budget (8-12), capped at ${MAX_SEARCH_FILES}`,
    ),
});

export type InsightSearchToolDeps = {
  workspaceId: string;
  projectPath: string;
  settings: InsightSettingsPort;
  readFile: RenderCodeReader;
};

function mapInsightSearchError(err: unknown): string {
  const code = (err as { code?: string })?.code;

  if (err instanceof InsightDisabledError || code === 'INSIGHT_DISABLED') {
    return `**Error**: Insight is disabled for this workspace.\n**Suggestion**: Insight search is not available right now. Continue without it and user other tools to explore.`;
  }
  if (err instanceof InsightSyncThrottledError || code === 'INSIGHT_SYNC_THROTTLED') {
    return `**Error**: Insight is temporarily busy.\n**Suggestion**: Insight Index maybe syncing. Try again later or use \`list_files\` and \`grep\` for now.`;
  }
  return `**Error**: Insight is temporarily unavailable.\n**Suggestion**: The code index is not ready. Try again later or continue with \`list_files\` and \`grep\`.`;
}

async function guardSearchOutput(content: string, projectPath: string): Promise<string> {
  if (content.length === 0) return content;
  try {
    const guarded = await truncateToolOutput({
      content,
      projectPath,
      toolName: 'insight_search',
      mode: 'head',
      maxChars: MAX_SEARCH_VISIBLE_CHARS,
      maxLines: MAX_SEARCH_VISIBLE_LINES,
    });
    return guarded.text;
  } catch {
    return content;
  }
}

export function createInsightSearchTool(deps: InsightSearchToolDeps): AgentTool[] {
  const tool: AgentTool<typeof insightSearchSchema> = {
    name: 'insight_search',
    description:
      'Last-resort symbol lookup in the code index (functions, types, classes, constants). Prefer `grep` first whenever you know any identifier, text, or file hint - only use this when the target symbol is completely unknown and grep cannot help.',
    inputSchema: insightSearchSchema,
    execute: async ({
      query,
      mode,
      limit,
      file,
      container,
      maxFiles,
    }: z.infer<typeof insightSearchSchema>) => {
      try {
        const result: InsightSearchResult = await insightSearch(
          { workspaceId: deps.workspaceId, settings: deps.settings },
          { query, mode, limit, file, container },
        );
        const { markdown } = await formatInsightSearchWithCode(result, deps.readFile, { maxFiles });
        return await guardSearchOutput(markdown, deps.projectPath);
      } catch (err) {
        const formatted = mapInsightSearchError(err);
        return await guardSearchOutput(formatted, deps.projectPath);
      }
    },
  };

  return [tool];
}
