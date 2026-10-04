import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { getAttachment, uploadAttachment } from '../../actions/index.js';
import {
  validateAttachmentParams,
  validateAttachmentWorkspace,
  validateUploadAttachment,
} from '../../validators/attachment.js';

export function registerAttachmentRoutes(app: FastifyInstance, ctx: Container) {
  app.post('/workspaces/:workspaceId/attachments', async (req, reply) => {
    const { workspaceId } = validateAttachmentWorkspace(req.params);
    const input = validateUploadAttachment(req.body);
    const { attachment } = await uploadAttachment(ctx, {
      workspaceId,
      filename: input.filename,
      mediaType: input.mediaType,
      dataBase64: input.dataBase64,
    });
    reply.code(201);
    return { attachment };
  });

  app.get('/workspaces/:workspaceId/attachments/:attachmentId', async (req, reply) => {
    const { workspaceId, attachmentId } = validateAttachmentParams(req.params);
    const { meta, bytes } = await getAttachment(ctx, { workspaceId, attachmentId });
    reply.header('Content-Type', meta.mediaType);
    reply.header('Content-Length', String(meta.sizeBytes));
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header(
      'Content-Disposition',
      `inline; filename="${meta.originalFilename.replace(/["\r\n]/g, '_')}"`,
    );
    return reply.send(bytes);
  });
}
