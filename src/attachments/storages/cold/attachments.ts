import { eq, and, lt } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdAttachmentsStorage } from '../../types/attachment.js';
import { attachments, type AttachmentRow, type NewAttachmentRow } from '../../schemas/attachments.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { AttachmentsDomainError } from '../../errors/base.js';

export class ColdAttachmentsStorage implements IColdAttachmentsStorage {
  constructor(protected readonly db: Database) {}

  async insert(row: NewAttachmentRow): Promise<AttachmentRow> {
    try {
      const rows = await this.db.insert(attachments).values(row).returning();
      const created = rows[0];
      if (!created) throw new Error('insert returned no rows');
      return created;
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageWriteError('attachments', err, { id: row.id });
    }
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    try {
      const rows = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageReadError('attachments', err, { id });
    }
  }

  async markLinked(id: string): Promise<AttachmentRow> {
    try {
      const rows = await this.db
        .update(attachments)
        .set({ status: 'linked', expiresAt: null })
        .where(eq(attachments.id, id))
        .returning();
      const updated = rows[0];
      if (!updated) throw new Error(`attachment ${id} not found for markLinked`);
      return updated;
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageWriteError('attachments', err, { id });
    }
  }

  async listExpiredPending(nowIso: string): Promise<AttachmentRow[]> {
    try {
      return await this.db
        .select()
        .from(attachments)
        .where(and(eq(attachments.status, 'pending'), lt(attachments.expiresAt, nowIso)));
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageReadError('attachments', err, {});
    }
  }

  async deleteById(id: string): Promise<void> {
    try {
      await this.db.delete(attachments).where(eq(attachments.id, id));
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageWriteError('attachments', err, { id });
    }
  }
}
