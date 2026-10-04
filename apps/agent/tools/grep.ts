import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import type { FmResult, GrepData, GrepService } from '../../../src/fm/index.js';
import { isFmPendingApproval } from '../../../src/fm/index.js';
import type { FmPermissionResolver } from '../../shared/fm-permission.js';
import { formatGrep, formatGrepError } from './format.js';
import { truncateToolOutput } from '../utils/truncate.js';
import { createRepeatGuard } from '../utils/dedup.js';

export const DEFAULT_GREP_LIMIT = 50;
export const MAX_GREP_LIMIT = 200;

export const grepSchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'Regex pattern to search for (e.g. "useState", "foo\\d+"). Set regex:false to search it as literal text (e.g. "foo(bar")',
    ),
  path: z
    .string()
    .default('.')
    .describe(
      'File or directory to search, relative to the workspace (e.g. "src/", "src/a.ts"). Defaults to "." (whole workspace)',
    ),
  regex: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Treat pattern as regex. Set false for literal/fixed-string search. Defaults to true',
    ),
  caseInsensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-insensitive matching. Defaults to false (case-sensitive, like ripgrep)'),
  include: z
    .array(z.string().min(1).max(500))
    .max(20)
    .optional()
    .describe('Array of globs to restrict searched files (e.g. ["*.ts", "*.tsx"]).'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Search gitignored entries too (node_modules/.git/.gitignore matches). Defaults to false',
    ),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .default('content')
    .optional()
    .describe(
      'Result shape: "content" shows matching lines (L:C + text, grouped per file); "files_with_matches" lists only file paths (cheapest, for broad sweeps); "count" shows per-file match counts plus the total. Defaults to "content"',
    ),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(MAX_GREP_LIMIT)
    .default(DEFAULT_GREP_LIMIT)
    .optional()
    .describe(
      `Max matches returned; defaults to ${DEFAULT_GREP_LIMIT}, capped at ${MAX_GREP_LIMIT}`,
    ),
});

export interface GrepToolDeps {
  projectPath: string;
}

function toGrepResult(
  result: FmResult<GrepData>,
  opts?: {
    path?: string;
    maxShown?: number;
    outputMode?: 'content' | 'files_with_matches' | 'count';
  },
): string {
  if (!result.success) {
    return formatGrepError(result.error.code, result.error.message, opts?.path);
  }
  return formatGrep(result.data, {
    path: opts?.path,
    maxShown: opts?.maxShown,
    outputMode: opts?.outputMode,
  });
}

async function guardGrepOutput(content: string, projectPath: string): Promise<string> {
  if (content.length === 0) return content;
  try {
    const guarded = await truncateToolOutput({
      content,
      projectPath,
      toolName: 'grep',
      mode: 'head',
    });
    return guarded.text;
  } catch {
    return content;
  }
}

export function createGrepTool(
  grep: Pick<GrepService, 'grep'>,
  deps: GrepToolDeps,
  options?: {
    resolvePermission?: FmPermissionResolver<GrepData>;
  },
): AgentTool[] {
  const repeatGuard = createRepeatGuard();
  const tool: AgentTool<typeof grepSchema> = {
    name: 'grep',
    description:
      'Search file contents with a regex pattern (ripgrep). Returns matches grouped per file — use "content" for matching lines with 1-based L:C numbers, "files_with_matches" for a cheap file list on broad sweeps, "count" for per-file totals. ' +
      'Scope with path (a folder or a single file) and include globs (e.g. ["*.ts"]). ' +
      'Use it when you know text or an identifier; do NOT use it for symbol relations(use insight_trace) or to list structure (use list_files). ' +
      'After content matches. Literal braces need escaping (e.g. "interface\\{\\}"), or set regex:false.',
    inputSchema: grepSchema,
    execute: async (
      {
        pattern,
        path,
        regex,
        caseInsensitive,
        include,
        includeIgnored,
        output_mode,
        maxResults,
      }: z.infer<typeof grepSchema>,
      toolOptions?: AgentToolExecuteOptions,
    ) => {
      const outputMode = output_mode ?? 'content';
      const repeated = repeatGuard.check(
        JSON.stringify({
          pattern,
          path,
          regex,
          caseInsensitive,
          include,
          includeIgnored,
          outputMode,
          maxResults,
        }),
        'grep',
      );
      if (repeated) return repeated;
      const result = await grep.grep(path, pattern, {
        regex,
        caseInsensitive: caseInsensitive ?? false,
        include,
        includeIgnored,
        maxResults,
      });
      if (isFmPendingApproval(result)) {
        if (!options?.resolvePermission) {
          const text = formatGrepError(result.error.code, result.error.message, path);
          return await guardGrepOutput(text, deps.projectPath);
        }
        const outcome = await options.resolvePermission(result, toolOptions?.toolCallId);
        const text = toGrepResult(outcome, { path, maxShown: maxResults, outputMode });
        return await guardGrepOutput(text, deps.projectPath);
      }
      const text = toGrepResult(result, { path, maxShown: maxResults, outputMode });
      return await guardGrepOutput(text, deps.projectPath);
    },
  };

  return [tool];
}
