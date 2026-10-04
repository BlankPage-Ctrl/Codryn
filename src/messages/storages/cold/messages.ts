import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdMessagesStorage } from '../../types/cold-messages-storage.js';
import { messages, type MessageRow, type NewMessageRow } from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { MessagesDomainError } from '../../errors/base.js';

export class ColdMessagesStorage implements IColdMessagesStorage {
  constructor(protected readonly db: Database) {}

  async findByChatId(chatId: string): Promise<MessageRow[]> {
    try {
      return await this.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.position);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('messages', err, { chatId });
    }
  }

  async findById(id: string): Promise<MessageRow | null> {
    try {
      const rows = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('messages', err, { id });
    }
  }

  async insert(row: NewMessageRow): Promise<MessageRow> {
    try {
      const rows = await this.db.insert(messages).values(row).returning();
      return rows[0];
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { row });
    }
  }

  async deleteById(chatId: string, messageId: string): Promise<void> {
    try {
      await this.db
        .delete(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageId });
    }
  }

  async deleteByIds(chatId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.db
        .delete(messages)
        .where(and(eq(messages.chatId, chatId), inArray(messages.id, messageIds)));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageIds });
    }
  }

  async deleteByChatId(chatId: string): Promise<void> {
    try {
      await this.db.delete(messages).where(eq(messages.chatId, chatId));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId });
    }
  }

  async getMaxPosition(chatId: string): Promise<number | null> {
    try {
      // No partial select: the Database union only accepts select() without
      // args, so read the top row by descending position instead of max().
      const rows = await this.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.position))
        .limit(1);
      return rows[0]?.position ?? null;
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('messages', err, { chatId });
    }
  }
}
