import { getAttachment, uploadAttachment } from '../../actions/index.js';
import {
  AttachmentParamsSchema,
  AttachmentWorkspaceParamsSchema,
  UploadAttachmentBodySchema,
} from '../../validators/attachment.js';
import { act, type StdioMethod } from './types.js';

export const attachmentMethods: Record<string, StdioMethod> = {
  'upload.attachment': {
    kind: 'plain',
    validate: (p) =>
      AttachmentWorkspaceParamsSchema.extend(UploadAttachmentBodySchema.shape).parse(p),
    run: act(uploadAttachment),
  },
  'get.attachment': {
    kind: 'plain',
    validate: (p) => AttachmentParamsSchema.parse(p),
    // Bytes are re-encoded as base64 so the NDJSON transport stays text-only.
    run: act(async (ctx, params: { workspaceId: string; attachmentId: string }) => {
      const { meta, bytes } = await getAttachment(ctx, params);
      return { attachment: meta, dataBase64: bytes.toString('base64') };
    }),
  },
};
