import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type {
  IColdMessagePartsStorage,
  MessagePartUpdateRow,
} from '../../types/cold-message-parts-storage.js';
import {
  messageParts,
  messages,
  type MessagePartRow,
  type NewMessagePartRow,
} from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { MessagesDomainError } from '../../errors/base.js';
import { withBusyRetry } from '../../utils/retry.js';
import type PQueue from 'p-queue';

export class ColdMessagePartsStorage implements IColdMessagePartsStorage {
  constructor(
    protected readonly db: Database,
    private readonly queue?: PQueue,
  ) {}

  async findByMessageIds(messageIds: string[]): Promise<MessagePartRow[]> {
    if (messageIds.length === 0) return [];
    try {
      return await this.db
        .select()
        .from(messageParts)
        .where(inArray(messageParts.messageId, messageIds))
        .orderBy(messageParts.position);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_parts', err, { messageIds });
    }
  }

  async findByMessageId(messageId: string): Promise<MessagePartRow[]> {
    try {
      return await this.db
        .select()
        .from(messageParts)
        .where(eq(messageParts.messageId, messageId))
        .orderBy(messageParts.position);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_parts', err, { messageId });
    }
  }

  async insertMany(rows: NewMessagePartRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      const run = async () => {
        await this.db.insert(messageParts).values(rows);
      };
      if (this.queue) {
        await withBusyRetry(() => this.queue!.add(run) as Promise<void>);
      } else {
        await withBusyRetry(run);
      }
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { count: rows.length });
    }
  }

  async updateMany(rows: MessagePartUpdateRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      const run = async () => {
        this.db.transaction((tx) => {
          for (const row of rows) {
            const { id, ...fields } = row;
            tx.update(messageParts).set(fields).where(eq(messageParts.id, id)).run();
          }
        });
      };
      if (this.queue) {
        await withBusyRetry(() => this.queue!.add(run) as Promise<void>);
      } else {
        await withBusyRetry(run);
      }
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { count: rows.length });
    }
  }

  async deleteByMessageIds(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.db.delete(messageParts).where(inArray(messageParts.messageId, messageIds));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { messageIds });
    }
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.db.delete(messageParts).where(inArray(messageParts.id, ids));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { ids });
    }
  }

  async deleteByChatId(chatId: string): Promise<void> {
    try {
      await this.db
        .delete(messageParts)
        .where(
          sql`${messageParts.messageId} IN (SELECT id FROM ${messages} WHERE ${messages.chatId} = ${chatId})`,
        );
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { chatId });
    }
  }
}
