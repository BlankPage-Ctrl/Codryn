import type { Container } from '../bootstrap.js';
import { ApiErrorCode, AppError, NotFoundError } from '../shared/errors.js';
import { AttachmentsDomainError } from '../../src/attachments/errors/base.js';
import type { AttachmentMeta } from '../../src/attachments/index.js';

export interface GetAttachmentParams {
  workspaceId: string;
  attachmentId: string;
}

export interface GetAttachmentResult {
  meta: AttachmentMeta;
  bytes: Buffer;
}

export async function getAttachment(
  ctx: Container,
  params: GetAttachmentParams,
): Promise<GetAttachmentResult> {
  try {
    return await ctx.attachmentsService.readForWorkspace(params.workspaceId, params.attachmentId);
  } catch (err) {
    if (err instanceof AttachmentsDomainError) {
      if (err.code === 'NOT_FOUND') throw new NotFoundError(err.message);
      if (err.code === 'FORBIDDEN') {
        throw new AppError(403, err.message, ApiErrorCode.FORBIDDEN);
      }
      throw err;
    }
    throw err;
  }
}
