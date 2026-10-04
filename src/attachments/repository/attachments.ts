import {
  attachmentInsertSchema,
  attachmentSelectSchema,
} from '../schemas/zod/index.js';
import type {
  AttachmentMeta,
  IColdAttachmentsStorage,
  NewAttachmentRow,
} from '../types/attachment.js';
import { ValidationError } from '../errors/validation.js';

function toMeta(row: NewAttachmentRow & { id: string }): AttachmentMeta {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    originalFilename: row.originalFilename,
    storedFilename: row.storedFilename,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    status: row.status === 'linked' ? 'linked' : 'pending',
    createdAt: row.createdAt ?? new Date().toISOString(),
    expiresAt: row.expiresAt ?? null,
  };
}

function parseStored(row: unknown, attachmentId?: string): AttachmentMeta {
  try {
    const parsed = attachmentSelectSchema.parse(row);
    return toMeta({ ...parsed, id: parsed.id });
  } catch (err) {
    throw new ValidationError('Invalid attachment row from storage', {
      ...(attachmentId ? { attachmentId } : {}),
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export class AttachmentsRepository {
  constructor(private readonly cold: IColdAttachmentsStorage) {}

  async insert(row: NewAttachmentRow): Promise<AttachmentMeta> {
    let validated: NewAttachmentRow;
    try {
      validated = attachmentInsertSchema.parse(row);
    } catch (err) {
      throw new ValidationError('Invalid attachment for insert', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    const created = await this.cold.insert(validated);
    return parseStored(created, validated.id ?? undefined);
  }

  async findMeta(id: string): Promise<AttachmentMeta | null> {
    if (!id) throw new ValidationError('Invalid attachmentId for findMeta', { id });
    const row = await this.cold.findById(id);
    if (!row) return null;
    return parseStored(row, id);
  }

  async markLinked(id: string): Promise<AttachmentMeta> {
    if (!id) throw new ValidationError('Invalid attachmentId for markLinked', { id });
    const row = await this.cold.markLinked(id);
    return parseStored(row, id);
  }

  async listExpiredPending(now: Date): Promise<AttachmentMeta[]> {
    const rows = await this.cold.listExpiredPending(now.toISOString());
    return rows.map((row) => parseStored(row));
  }

  async deleteMeta(id: string): Promise<void> {
    if (!id) throw new ValidationError('Invalid attachmentId for deleteMeta', { id });
    await this.cold.deleteById(id);
  }
}
