import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import { toReadFileRichBody, type OnRichResult } from './rich-result.js';
import type {
  FmResult,
  ReadFileData,
  ReadFileOptions,
  ReadFileService,
} from '../../../src/fm/index.js';
import { isFmPendingApproval } from '../../../src/fm/index.js';
import type { FmPermissionResolver } from '../../shared/fm-permission.js';
import { formatReadFile, formatToolError } from './format.js';
import { truncateToolOutput } from '../utils/truncate.js';
import { createReadSubsetGuard, createRepeatGuard } from '../utils/dedup.js';

export const DEFAULT_READFILE_MAX_BYTES = 12_000;
export const MAX_READFILE_LIMIT = 200;
export const MAX_READFILE_VISIBLE_CHARS = 24_000;
export const MAX_READFILE_VISIBLE_LINES = 300;

export const readFileSchema = z
  .object({
    path: z.string().describe('Relative path inside the workspace'),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '1-indexed start line for pagination (inclusive). Alternative to offset — set one, not both.',
      ),
    endLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '1-indexed end line for pagination (inclusive). Alternative to limit — set one, not both.',
      ),
    offset: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .optional()
      .describe(
        '1-indexed start offset, same as startLine; offset=1 is the first line. Alternative to startLine — set one, not both.',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_READFILE_LIMIT)
      .optional()
      .describe(
        `Max lines to read from offset; capped at ${MAX_READFILE_LIMIT}. Alternative to endLine — set one, not both.`,
      ),
  })
  .superRefine((val, ctx) => {
    if (val.limit !== undefined && val.endLine !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set either limit or endLine, not both.',
        path: ['limit'],
      });
    }
    if (val.offset !== undefined && val.startLine !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set either offset or startLine, not both.',
        path: ['offset'],
      });
    }
  });

function toReadResult(result: FmResult<ReadFileData>, opts?: ReadFileOptions): string {
  if (!result.success) {
    return formatToolError(result.error.code, result.error.message);
  }
  return formatReadFile(result.data, {
    startLine: opts?.startLine,
    endLine: opts?.endLine,
  });
}

async function guardReadFileOutput(
  content: string,
  projectPath: string | undefined,
): Promise<string> {
  if (content.length === 0 || !projectPath) return content;
  try {
    const guarded = await truncateToolOutput({
      content,
      projectPath,
      toolName: 'read_file',
      mode: 'head',
      maxChars: MAX_READFILE_VISIBLE_CHARS,
      maxLines: MAX_READFILE_VISIBLE_LINES,
    });
    return guarded.text;
  } catch {
    return content;
  }
}

export function createReadFileTool(
  readFile: Pick<ReadFileService, 'readFile'>,
  options?: {
    onRichResult?: OnRichResult;
    resolvePermission?: FmPermissionResolver<ReadFileData>;
    projectPath?: string;
  },
): AgentTool[] {
  const subsetGuard = createReadSubsetGuard();
  const repeatGuard = createRepeatGuard();
  const tool: AgentTool<typeof readFileSchema> = {
    name: 'read_file',
    description:
      'Read a file in a large window (up to ~200 lines); read small files whole. ' +
      'startLine/endLine for an absolute block (grep L65-90 -> 65-90), ' +
      'or offset/limit to continue (offset=121, limit=120 continues after line 120). ' +
      'One wide read beats many narrow ones; never re-read a covered range.' +
      "Do Not set a 'limit' and 'endLine' simultaneously.",
    inputSchema: readFileSchema,
    execute: async (
      { path, startLine, endLine, offset, limit },
      toolOptions?: AgentToolExecuteOptions,
    ) => {
      // offset/limit and startLine/endLine are mutually exclusive per the
      // schema above; both are 1-indexed, normalize to an absolute range.
      const start = startLine ?? offset ?? 1;
      const end = endLine ?? (limit !== undefined ? start + limit - 1 : undefined);
      const repeated = repeatGuard.check(
        JSON.stringify({
          path,
          DEFAULT_READFILE_MAX_BYTES,
          startLine: start,
          endLine: end ?? null,
        }),
        'read_file',
      );
      if (repeated) return repeated;
      const subset = subsetGuard.check(path, start, end);
      if (subset) return subset;
      const finishRead = async (content: string): Promise<string> => {
        const text = await guardReadFileOutput(content, options?.projectPath);
        subsetGuard.record(path, start, end, !text.includes('<truncate>'));
        return text;
      };
      const result = await readFile.readFile(path, {
        maxBytes: DEFAULT_READFILE_MAX_BYTES,
        withLineNumbers: true,
        startLine: start,
        endLine: end,
      });
      if (isFmPendingApproval(result)) {
        if (!options?.resolvePermission) {
          return formatToolError(result.error.code, result.error.message);
        }
        const outcome = await options.resolvePermission(result, toolOptions?.toolCallId);
        if (outcome.success && toolOptions?.toolCallId && options?.onRichResult) {
          options.onRichResult({
            toolCallId: toolOptions.toolCallId,
            implement: 'read_file',
            body: toReadFileRichBody(toolOptions.toolCallId, outcome.data),
          });
        }
        return await finishRead(toReadResult(outcome, { startLine: start, endLine: end }));
      }
      if (result.success && toolOptions?.toolCallId && options?.onRichResult) {
        options.onRichResult({
          toolCallId: toolOptions.toolCallId,
          implement: 'read_file',
          body: toReadFileRichBody(toolOptions.toolCallId, result.data),
        });
      }
      return await finishRead(toReadResult(result, { startLine: start, endLine: end }));
    },
  };

  return [tool];
}
