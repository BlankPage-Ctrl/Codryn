import { eq, and } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdChatStorage } from '../../types/cold-chat-storage.js';
import { chats, type ChatRow, type NewChatRow } from '../../schemas/index.js';
import { ChatDomainError } from '../../errors/base.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { ChatNotFoundError } from '../../errors/not-found.js';

export class ColdChatStorage implements IColdChatStorage {
  constructor(protected readonly db: Database) {}

  async findById(id: string): Promise<ChatRow | null> {
    try {
      const rows = await this.db.select().from(chats).where(eq(chats.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageReadError('chats', err, { id });
    }
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<ChatRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(chats)
        .where(and(eq(chats.id, id), eq(chats.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageReadError('chats', err, { id, workspaceId });
    }
  }

  async findAllByWorkspace(workspaceId: string): Promise<ChatRow[]> {
    try {
      return await this.db
        .select()
        .from(chats)
        .where(eq(chats.workspaceId, workspaceId))
        .orderBy(chats.updatedAt);
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageReadError('chats', err, { workspaceId });
    }
  }

  async insert(row: NewChatRow): Promise<ChatRow> {
    try {
      const rows = await this.db.insert(chats).values(row).returning();
      if (!rows[0]) throw new StorageWriteError('chats', 'empty returning', { id: row.id });
      return rows[0];
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageWriteError('chats', err, { id: row.id });
    }
  }

  async update(id: string, patch: Partial<NewChatRow>): Promise<ChatRow> {
    try {
      const rows = await this.db
        .update(chats)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(chats.id, id))
        .returning();
      if (!rows[0]) throw new ChatNotFoundError(id);
      return rows[0];
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageWriteError('chats', err, { id, patch });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(chats).where(eq(chats.id, id));
    } catch (err) {
      if (err instanceof ChatDomainError) throw err;
      throw new StorageWriteError('chats', err, { id });
    }
  }
}
