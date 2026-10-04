import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import z from 'zod';
import { toEditFileRichBody, type OnRichResult } from './rich-result.js';
import type { EditFileService, FileEditContext } from '../../../src/fm/index.js';
import {
  ParseEditError,
  parseEditInput,
  MAX_RAW_CHARS,
  SEARCH_HEADER_PREFIX,
  SEARCH_SEPARATOR,
  REPLACE_FOOTER,
  MAX_EDIT_BLOCKS,
} from '../utils/parser.js';
import { formatEditFailure, formatEditFile } from './format.js';

export const editFileRawSchema = z.object({
  raw: z
    .string()
    .min(1)
    .max(MAX_RAW_CHARS)
    .describe(
      'Raw edit message: first line is the workspace-relative file path, followed by one or more ' +
        `"${SEARCH_HEADER_PREFIX} … ${SEARCH_SEPARATOR} … ${REPLACE_FOOTER}" blocks. ` +
        'The `lines <start>[-<end>]` hint after SEARCH is optional but very recommended.',
    ),
});

export type EditFileRawInput = z.infer<typeof editFileRawSchema>;

/** Provenance for the file-history ledger. Omitted = no history recorded. */
export interface EditToolHistoryContext {
  workspaceId: string;
  chatId: string;
  /** Assistant message producing the edit. */
  messageId: string;
  runId?: string;
}

export function createEditTool(
  editService: Pick<EditFileService, 'editFile'>,
  options?: { onRichResult?: OnRichResult; history?: EditToolHistoryContext },
): AgentTool[] {
  const editFile: AgentTool<typeof editFileRawSchema> = {
    name: 'edit_file',
    description:
      'Edit a UTF-8 text file under the workspace using SEARCH/REPLACE blocks. ' +
      'First line is the workspace-relative file path, then one or more blocks(up to ' +
      MAX_EDIT_BLOCKS +
      ' blocks): ' +
      '`<<<<<<< SEARCH [lines <start>[-<end>]]`, the exact original text, `=======`, ' +
      'the replacement text, `>>>>>>> REPLACE`. ' +
      'SEARCH must match file content exactly: copy it from read_file. ' +
      'The `lines` hint is optional but very recommended when the text repeats. ' +
      'An empty replacement deletes the matched text. ' +
      'One file per call; edit other files with additional calls. ' +
      'Refuses paths outside the project root. Concurrent edits to the same file are serialized.',
    inputSchema: editFileRawSchema,
    execute: async ({ raw }, toolOptions?: AgentToolExecuteOptions) => {
      let input;
      try {
        input = parseEditInput(raw);
      } catch (error) {
        if (error instanceof ParseEditError) {
          return formatEditFailure('VALIDATION_FAILED', error.message);
        }
        throw error;
      }

      const result = await editService.editFile(
        input,
        toHistoryContext(options?.history, toolOptions?.toolCallId),
      );
      if (!result.success) {
        const details = result.error.details;
        const path = input.path;
        return formatEditFailure(result.error.code, result.error.message, details, path);
      }

      if (toolOptions?.toolCallId && options?.onRichResult) {
        options.onRichResult({
          toolCallId: toolOptions.toolCallId,
          implement: 'edit_file',
          body: toEditFileRichBody(toolOptions.toolCallId, result.data),
        });
      }
      return formatEditFile(result.data);
    },
  };

  return [editFile];
}

function toHistoryContext(
  history: EditToolHistoryContext | undefined,
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
