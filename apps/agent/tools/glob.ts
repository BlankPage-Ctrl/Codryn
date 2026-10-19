import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import { toGlobRichBody, type OnRichResult } from './rich-result.js';
import type { FmResult, GlobData, GlobService } from '../../../src/fm/index.js';
import { DEFAULT_GLOB_LIMIT, MAX_GLOB_LIMIT, formatGlob, formatToolError } from './format.js';

export const globSchema = z.object({
  pattern: z.string().min(1).describe('Glob pattern to match file.'),
  path: z
    .string()
    .default('.')
    .describe('Directory to search in, relative to the workspace or absolute.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_GLOB_LIMIT)
    .default(DEFAULT_GLOB_LIMIT)
    .describe('Max files shown; defaults to 100'),
  includeIgnored: z
    .boolean()
    .default(false)
    .describe('Show gitignored entries (node_modules/.git/.gitignore matches).'),
});

function toGlobResult(result: FmResult<GlobData>, opts?: { limit?: number }): string {
  if (!result.success) {
    return formatToolError(result.error.code, result.error.message);
  }
  return formatGlob(result.data.pattern, result.data.requestedPath, result.data.nodes, {
    limit: opts?.limit,
    truncated: result.data.truncated,
  });
}

export function createGlobTool(
  glob: Pick<GlobService, 'glob'>,
  options?: { onRichResult?: OnRichResult },
): AgentTool[] {
  const globTool: AgentTool<typeof globSchema> = {
    name: 'glob',
    description:
      'Find files by name pattern across the workspace. Supports glob patterns like ' +
      '"**/*.ts", "src/**/*.{ts,tsx}, etc.".',
    inputSchema: globSchema,
    execute: async (
      { pattern, path, limit, includeIgnored },
      toolOptions?: AgentToolExecuteOptions,
    ) => {
      const result = await glob.glob(path, { pattern, includeIgnored, maxResults: limit });
      if (result.success && toolOptions?.toolCallId && options?.onRichResult) {
        options.onRichResult({
          toolCallId: toolOptions.toolCallId,
          implement: 'glob',
          body: toGlobRichBody(toolOptions.toolCallId, result.data, { limit }),
        });
      }
      return toGlobResult(result, { limit });
    },
  };

  return [globTool];
}
