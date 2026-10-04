import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import { toListFilesRichBody, type OnRichResult } from './rich-result.js';
import type { FmResult, ListDirData, ListDirService } from '../../../src/fm/index.js';
import { isFmPendingApproval } from '../../../src/fm/index.js';
import type { FmPermissionResolver } from '../../shared/fm-permission.js';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, formatListDir, formatToolError } from './format.js';

export const listFilesSchema = z.object({
  path: z.string().default('.').describe('Relative path inside the workspace. Defaults to "."'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe('Max entries shown; defaults to 200'),
  includeIgnored: z
    .boolean()
    .default(false)
    .describe('Show gitignored entries (node_modules/.git/.gitignore matches). Defaults to false'),
});

function toListResult(
  result: FmResult<ListDirData>,
  opts?: { limit?: number; includeIgnored?: boolean },
): string {
  if (!result.success) {
    return formatToolError(result.error.code, result.error.message);
  }
  return formatListDir(result.data.requestedPath, result.data.nodes, opts);
}

export function createListFilesTool(
  listDir: Pick<ListDirService, 'listDir'>,
  options?: {
    onRichResult?: OnRichResult;
    resolvePermission?: FmPermissionResolver<ListDirData>;
  },
): AgentTool[] {
  const listFiles: AgentTool<typeof listFilesSchema> = {
    name: 'list_files',
    description: 'Explore the workspace structure by listing files and directories.',
    inputSchema: listFilesSchema,
    execute: async ({ path, limit, includeIgnored }, toolOptions?: AgentToolExecuteOptions) => {
      const result = await listDir.listDir(path, { includeIgnored });
      if (isFmPendingApproval(result)) {
        if (!options?.resolvePermission) {
          return formatToolError(result.error.code, result.error.message);
        }
        const outcome = await options.resolvePermission(result, toolOptions?.toolCallId);
        if (outcome.success && toolOptions?.toolCallId && options?.onRichResult) {
          options.onRichResult({
            toolCallId: toolOptions.toolCallId,
            implement: 'list_files',
            body: toListFilesRichBody(toolOptions.toolCallId, outcome.data, {
              limit,
            }),
          });
        }
        return toListResult(outcome, { limit, includeIgnored });
      }
      if (result.success && toolOptions?.toolCallId && options?.onRichResult) {
        options.onRichResult({
          toolCallId: toolOptions.toolCallId,
          implement: 'list_files',
          body: toListFilesRichBody(toolOptions.toolCallId, result.data, {
            limit,
          }),
        });
      }
      return toListResult(result, { limit, includeIgnored });
    },
  };

  return [listFiles];
}
