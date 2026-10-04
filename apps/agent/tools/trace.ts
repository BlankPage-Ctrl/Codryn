import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import { insightTrace } from '../../insight/index.js';
import {
  InsightBinaryError,
  InsightDisabledError,
  InsightEntryNotFoundError,
  InsightSyncThrottledError,
} from '../../insight/execute/errors.js';
import { formatInsightTrace, type RenderCodeReader } from '../../insight/format/index.js';
import type { InsightSettingsPort, InsightTraceReport } from '../../insight/types.js';
import { truncateToolOutput } from '../utils/truncate.js';

const MAX_TRACE_DEPTH = 25;
const MAX_TRACE_TRAILS = 4;
const MAX_TRACE_FILES = 10;

export const insightTraceSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Bag of symbol names, whitespace, comma, or semicolon separated, capped at 32 (e.g., "AuthService loginUser" or "readFile SuperUser resetPassword").',
      ),
    from: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Start symbol for a directed trace; must be paired with `to`'),
    to: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Target symbol for a directed trace; must be paired with `from`'),
    maxDepth: z
      .number()
      .int()
      .positive()
      .max(MAX_TRACE_DEPTH)
      .optional()
      .describe(`Max traversal depth; capped at ${MAX_TRACE_DEPTH}, binary default when omitted`),
    maxTrails: z
      .number()
      .int()
      .positive()
      .max(MAX_TRACE_TRAILS)
      .optional()
      .describe(`Max trails returned; capped at ${MAX_TRACE_TRAILS}, binary default when omitted`),
    kinds: z
      .array(z.enum(['calls', 'extends', 'implements', 'param', 'return', 'uses']))
      .optional()
      .describe('Edge kinds filter; default all'),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(MAX_TRACE_FILES)
      .optional()
      .describe(`Max files rendered; defaults to tier budget (5-10), capped at ${MAX_TRACE_FILES}`),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'from and to must be set together',
    path: ['from'],
  });

export type InsightTraceToolDeps = {
  workspaceId: string;
  projectPath: string;
  settings: InsightSettingsPort;
  readFile: RenderCodeReader;
};

function mapInsightTraceError(err: unknown): string {
  const code = (err as { code?: string })?.code;

  if (err instanceof InsightDisabledError || code === 'INSIGHT_DISABLED') {
    return `**Error**: Insight is disabled for this workspace.\n**Suggestion**: Insight trace is not available right now. Continue without it and use other tools to explore.`;
  }
  if (err instanceof InsightSyncThrottledError || code === 'INSIGHT_SYNC_THROTTLED') {
    return `**Error**: Insight is temporarily busy.\n**Suggestion**: Insight Index maybe syncing. Try again later or use \`list_files\` and \`grep\` for now.`;
  }
  if (code === 'INSIGHT_BUSY') {
    return `**Error**: Insight is temporarily busy.\n**Suggestion**: A write is already running. Retry or check status first, or use \`list_files\` and \`grep\` for now.`;
  }
  if (err instanceof InsightEntryNotFoundError || code === 'INSIGHT_ENTRY_NOT_FOUND') {
    return `**Error**: Trace endpoint not found.\n**Suggestion**: The \`from\`/\`to\` symbol did not resolve. Try again with another similar symbol.`;
  }
  if (err instanceof InsightBinaryError || code === 'INSIGHT_BINARY_ERROR') {
    const detail = err instanceof Error ? err.message : 'invalid trace options';
    return `**Error**: Invalid trace request — ${detail}.\n**Suggestion**: If you use \`from\` or \`to\`,  they must be set together; optionally keep \`maxDepth\` <= ${MAX_TRACE_DEPTH} and \`maxTrails\` <= ${MAX_TRACE_TRAILS}.`;
  }
  return `**Error**: Insight is temporarily unavailable.\n**Suggestion**: The code index is not ready. Try again later or continue with \`list_files\` and \`grep\`.`;
}

async function guardTraceOutput(content: string, projectPath: string): Promise<string> {
  if (content.length === 0) return content;
  try {
    const guarded = await truncateToolOutput({
      content,
      projectPath,
      toolName: 'insight_trace',
      mode: 'head',
      maxChars: 20000,
      maxLines: 400,
    });
    return guarded.text;
  } catch {
    return content;
  }
}

export function createInsightTraceTool(deps: InsightTraceToolDeps): AgentTool[] {
  const tool: AgentTool<typeof insightTraceSchema> = {
    name: 'insight_trace',
    description:
      'Prefer this before grep/Read/manual search, great for architecture questions, bug hunts, locating symbols, or prepping an edit.' +
      'One call returns full verbatim source grouped' +
      'per file (already counts as Read, skip re-opening) plus the call graph between them. Feed it a plain question or a handful of ' +
      'symbol/file names; either works. In most cases this alone replaces the entire search-then-read cycle, at a fraction of the tokens and calls.' +
      "Accepts query alone or from+to alone, or both; 'from' requires 'to' and vice versa.",
    inputSchema: insightTraceSchema,
    execute: async ({
      query,
      from,
      to,
      maxDepth,
      maxTrails,
      kinds,
      maxFiles,
    }: z.infer<typeof insightTraceSchema>) => {
      try {
        const report: InsightTraceReport = await insightTrace(
          { workspaceId: deps.workspaceId, settings: deps.settings },
          { query, from, to, maxDepth, maxTrails, kinds },
        );
        const { markdown } = await formatInsightTrace(report, deps.readFile, { query, maxFiles });
        return await guardTraceOutput(markdown, deps.projectPath);
      } catch (err) {
        const formatted = mapInsightTraceError(err);
        return await guardTraceOutput(formatted, deps.projectPath);
      }
    },
  };

  return [tool];
}
