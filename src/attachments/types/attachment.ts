import { z } from 'zod';
import type { AttachmentRow, NewAttachmentRow } from '../schemas/attachments.js';

/** Opaque reference scheme used inside message parts: `attachment://<uuid>`. */
export const ATTACHMENT_URL_SCHEME = 'attachment://';

export const ALLOWED_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type AllowedImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // (8 MiB)

export const MAX_FILES_PER_MESSAGE = 5; // 5 Image per Message.

export const PENDING_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export const AttachmentStatusSchema = z.enum(['pending', 'linked']);
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;

export interface AttachmentMeta {
  id: string;
  workspaceId: string;
  originalFilename: string;
  storedFilename: string;
  mediaType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  createdAt: string;
  expiresAt: string | null;
}

export interface AttachmentUploadInput {
  workspaceId: string;
  filename: string;
  mediaType: string;
  dataBase64: string;
}

export interface IColdAttachmentsStorage {
  insert(row: NewAttachmentRow): Promise<AttachmentRow>;
  findById(id: string): Promise<AttachmentRow | null>;
  markLinked(id: string): Promise<AttachmentRow>;
  listExpiredPending(nowIso: string): Promise<AttachmentRow[]>;
  deleteById(id: string): Promise<void>;
}

export interface IAttachmentBytesStorage {
  write(workspaceId: string, storedFilename: string, bytes: Uint8Array): Promise<void>;
  read(workspaceId: string, storedFilename: string): Promise<Buffer>;
  remove(workspaceId: string, storedFilename: string): Promise<void>;
}

export interface IAttachmentsRepository {
  insert(row: NewAttachmentRow): Promise<AttachmentMeta>;
  findMeta(id: string): Promise<AttachmentMeta | null>;
  markLinked(id: string): Promise<AttachmentMeta>;
  listExpiredPending(now: Date): Promise<AttachmentMeta[]>;
  deleteMeta(id: string): Promise<void>;
}

// Row types live in schemas/; re-exported here so consumers import from one place.
export type { AttachmentRow, NewAttachmentRow } from '../schemas/attachments.js';
