// Types (domain constants, meta, ports)
export type {
  AttachmentMeta,
  AttachmentStatus,
  AttachmentUploadInput,
  AllowedImageMediaType,
  IColdAttachmentsStorage,
  IAttachmentBytesStorage,
  IAttachmentsRepository,
  AttachmentRow,
  NewAttachmentRow,
} from './types/index.js';

export {
  ATTACHMENT_URL_SCHEME,
  ALLOWED_IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MESSAGE,
  PENDING_ATTACHMENT_TTL_MS,
  AttachmentStatusSchema,
} from './types/index.js';

/* Drizzle schemas + drizzle-zod */
export { attachments } from './schemas/index.js';

export { attachmentInsertSchema, attachmentSelectSchema, attachmentUpdateSchema } from './schemas/zod/index.js';

export { sniffImageMediaType, type SniffedImageMediaType } from './engines/index.js';
export { sanitizeFilename, extensionForMediaType } from './utils/index.js';
export { ColdAttachmentsStorage, FileAttachmentBytesStorage } from './storages/cold/index.js';
export { AttachmentsRepository } from './repository/index.js';
export { AttachmentsService, type AttachmentSweepResult } from './services/index.js';
export * from './errors/index.js';
