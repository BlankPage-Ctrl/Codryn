import type { Container } from '../bootstrap.js';
import { AppError, NotFoundError, ValidationError } from '../shared/errors.js';
import { buildFmServices } from '../shared/fm-services.js';
import type { FileRevertResult } from '../../src/fm/index.js';
import { MessagesDomainError } from '../../src/messages/errors/base.js';
import { FmDomainError } from '../../src/fm/errors/base.js';

export interface RevertMessageRunParams {
  workspaceId: string;
  chatId: string;
  messageId: string;
  mode: 'conversation';
  /**
   * When true, files mutated by the reverted (suffix) messages are restored
   * to their checkpoint state via the file-history ledger, in addition to
   * deleting the conversation suffix. Collision policy is detect-and-skip:
   * paths changed after the AI edits are reported in
   * `fileRestore.conflicts` and left untouched.
   */
  restoreFiles?: boolean;
}

export interface RevertMessageRunResult {
  deletedMessageIds: string[];
  cancelledRunIds: string[];
  fileRestore?: FileRevertResult;
}

export async function revertMessageRun(
  ctx: Container,
  params: RevertMessageRunParams,
): Promise<RevertMessageRunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  if (params.mode !== 'conversation') {
    throw new ValidationError(`Unsupported revert mode: ${params.mode}`);
  }

  const cancelledRunIds: string[] = [];
  const runs = await ctx.runService.listByChat(params.chatId);
  for (const run of runs) {
    if (run.status !== 'running') continue;
    ctx.runService.requestCancel(run.runId);
    await ctx.runService.finish(run.runId, 'cancelled', {
      code: 'RUN_ABORTED',
      message: 'Run cancelled by revert',
    });
    cancelledRunIds.push(run.runId);
  }

  let deletedMessageIds: string[];
  try {
    const reverted = await ctx.messagesService.revertFromMessage(params.chatId, params.messageId);
    deletedMessageIds = reverted.deletedMessageIds;
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

  if (params.restoreFiles !== true) {
    return { deletedMessageIds, cancelledRunIds };
  }

  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  if (!ws) throw new NotFoundError(`Workspace ${params.workspaceId} not found`);
  const { fileRevertService } = await buildFmServices(ctx, ws.projectPath);

  let fileRestore: FileRevertResult;
  try {
    fileRestore = await fileRevertService.revertFromMessages({
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      messageIds: deletedMessageIds,
    });
  } catch (err) {
    if (err instanceof FmDomainError) {
      if (err.code === 'VALIDATION_FAILED' || err.code === 'INVALID_INPUT') {
        throw new ValidationError(err.message);
      }
      throw new AppError(err.statusCode, err.message, 'INTERNAL_ERROR');
    }
    throw err;
  }

  // Drop consumed ledger entries so the ledger does not grow unboundedly.
  // Entries touching a conflicted (skipped) path are KEPT: a later revert
  // to an earlier message must still detect the collision instead of
  // silently overwriting the out-of-band change. Best effort: the revert
  // itself already happened.
  try {
    const conflicted = new Set(fileRestore.conflicts.map((c) => c.path));
    if (conflicted.size === 0) {
      await ctx.fileHistoryStorage.deleteByMessageIds(params.chatId, deletedMessageIds);
    } else {
      const entries = await ctx.fileHistoryStorage.listByMessageIds(
        params.chatId,
        deletedMessageIds,
      );
      const tainted = new Set(
        entries.filter((e) => conflicted.has(e.path)).map((e) => e.messageId),
      );
      const consumable = deletedMessageIds.filter((id) => !tainted.has(id));
      await ctx.fileHistoryStorage.deleteByMessageIds(params.chatId, consumable);
    }
  } catch (err) {
    ctx.logger.warn({ err, chatId: params.chatId }, 'revert: history cleanup failed');
  }

  return { deletedMessageIds, cancelledRunIds, fileRestore };
}
