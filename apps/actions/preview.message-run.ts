import type { Container } from '../bootstrap.js';
import { AppError, NotFoundError, ValidationError } from '../shared/errors.js';
import { buildFmServices } from '../shared/fm-services.js';
import type { FileRevertPlanItem } from '../../src/fm/index.js';
import { MessagesDomainError } from '../../src/messages/errors/base.js';
import { FmDomainError } from '../../src/fm/errors/base.js';

export interface PreviewMessageRunParams {
  workspaceId: string;
  chatId: string;
  messageId: string;
  mode: 'conversation';
}

export interface PreviewMessageRunResult {
  targetMessageId: string;
  fromPosition: number;
  /** Message ids that a revert would delete (suffix including the target). */
  suffixIds: string[];
  /** Per-path file plan: what a file revert WOULD do. Advisory - the live
   * file can change between preview and revert; the revert result is
   * authoritative. */
  files: FileRevertPlanItem[];
}

export async function previewMessageRun(
  ctx: Container,
  params: PreviewMessageRunParams,
): Promise<PreviewMessageRunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  if (params.mode !== 'conversation') {
    throw new ValidationError(`Unsupported preview mode: ${params.mode}`);
  }

  // Read-only: never cancels runs, never deletes messages or files.
  let scope: { targetMessageId: string; fromPosition: number; suffixIds: string[] };
  try {
    scope = await ctx.messagesService.computeRevertScope(params.chatId, params.messageId);
  } catch (err) {
    if (err instanceof MessagesDomainError) {
      if (err.code === 'VALIDATION_FAILED' || err.code === 'INVALID_INPUT') {
        throw new ValidationError(err.message);
      }
      throw new AppError(
        err.statusCode,
        err.message,
        err.code === 'NOT_FOUND' ? ('NOT_FOUND' as const) : 'INTERNAL_ERROR',
      );
    }
    throw err;
  }

  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  if (!ws) throw new NotFoundError(`Workspace ${params.workspaceId} not found`);
  const { fileRevertService } = await buildFmServices(ctx, ws.projectPath);

  try {
    const preview = await fileRevertService.previewFromMessages({
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      messageIds: scope.suffixIds,
    });
    return {
      targetMessageId: scope.targetMessageId,
      fromPosition: scope.fromPosition,
      suffixIds: scope.suffixIds,
      files: preview.files,
    };
  } catch (err) {
    if (err instanceof FmDomainError) {
      if (err.code === 'VALIDATION_FAILED' || err.code === 'INVALID_INPUT') {
        throw new ValidationError(err.message);
      }
      throw new AppError(err.statusCode, err.message, 'INTERNAL_ERROR');
    }
    throw err;
  }
}
