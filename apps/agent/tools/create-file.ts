import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import { toCreateFileRichBody, type OnRichResult } from './rich-result.js';
import type { CreateFileService, FileEditContext } from '../../../src/fm/index.js';
import { formatCreateFile, formatCreateFailure } from './format.js';

export const createFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe('Workspace-relative file path, e.g. "src/utils/foo.ts" or "docs/new.md"'),
  content: z
    .string()
    .max(200_000)
    .default('')
    .describe('UTF-8 file content (max 200k chars). Empty string creates empty file.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Overwrite if file already exists. Defaults to false (ALREADY_EXISTS error if exists).',
    ),
});

export type CreateFileInput = z.infer<typeof createFileSchema>;

/** Provenance for the file-history ledger. Omitted = no history recorded. */
export interface CreateFileToolHistoryContext {
  workspaceId: string;
  chatId: string;
  /** Assistant message producing the file. */
  messageId: string;
  runId?: string;
}

export function createCreateFileTool(
  createFileService: Pick<CreateFileService, 'createFile'>,
  options?: { onRichResult?: OnRichResult; history?: CreateFileToolHistoryContext },
): AgentTool[] {
  const createFile: AgentTool<typeof createFileSchema> = {
    name: 'create_file',
    description:
      'Create a new UTF-8 text file under the workspace. ' +
      'Creates parent directories automatically (mkdir -p). ' +
      'Use list_files to inspect directories, read_file to verify. One file per call; create multiple files with parallel calls.',
    inputSchema: createFileSchema,
    execute: async ({ path, content, overwrite }, toolOptions?: AgentToolExecuteOptions) => {
      const result = await createFileService.createFile(
        { path, content, overwrite },
        toHistoryContext(options?.history, toolOptions?.toolCallId),
      );
      if (!result.success) {
        return formatCreateFailure(result.error.code, result.error.message, path);
      }

      if (toolOptions?.toolCallId && options?.onRichResult) {
        options.onRichResult({
          toolCallId: toolOptions.toolCallId,
          implement: 'create_file',
          body: toCreateFileRichBody(toolOptions.toolCallId, result.data),
        });
      }
      return formatCreateFile(result.data);
    },
  };

  return [createFile];
}

function toHistoryContext(
  history: CreateFileToolHistoryContext | undefined,
  toolCallId: string | undefined,
): FileEditContext | undefined {
  if (!history) return undefined;
  return {
    workspaceId: history.workspaceId,
    chatId: history.chatId,
    messageId: history.messageId,
    ...(history.runId !== undefined ? { runId: history.runId } : {}),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
  };
}
