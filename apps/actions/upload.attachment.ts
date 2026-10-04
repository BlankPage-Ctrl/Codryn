import type { Container } from '../bootstrap.js';
import { ValidationError } from '../shared/errors.js';
import { AttachmentsDomainError } from '../../src/attachments/errors/base.js';
import type { AttachmentMeta } from '../../src/attachments/index.js';

export interface UploadAttachmentParams {
  workspaceId: string;
  filename: string;
  mediaType: string;
  dataBase64: string;
}

export interface UploadAttachmentResult {
  attachment: AttachmentMeta;
}

export async function uploadAttachment(
  ctx: Container,
  params: UploadAttachmentParams,
): Promise<UploadAttachmentResult> {
  const workspace = await ctx.workspacesService.findOne(params.workspaceId);
  if (!workspace) throw new ValidationError(`Workspace ${params.workspaceId} not found`);

  try {
    const attachment = await ctx.attachmentsService.upload({
      workspaceId: params.workspaceId,
      filename: params.filename,
      mediaType: params.mediaType,
      dataBase64: params.dataBase64,
    });
    // Lazy GC: prune expired pending uploads on every upload. Fail-open -
    // a sweep failure must never fail the upload itself.
    try {
      const swept = await ctx.attachmentsService.sweepExpiredPending();
      if (swept.failures.length > 0) {
        ctx.logger.warn({ failures: swept.failures }, 'attachment sweep had failures');
      }
    } catch (err) {
      ctx.logger.warn({ err, workspaceId: params.workspaceId }, 'attachment sweep failed');
    }
    return { attachment };
  } catch (err) {
    if (err instanceof AttachmentsDomainError) {
      // Shape/ sniff/ limit problems are caller errors; storage failures
      // propagate untouched so they surface as 500, not 400.
      if (err.code === 'VALIDATION_FAILED') throw new ValidationError(err.message);
      throw err;
    }
    throw err;
  }
}
