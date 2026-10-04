import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { FmDomainError } from '../../errors/base.js';
import {
  fmFileHistory,
  type FileHistoryRow,
  type NewFileHistoryRow,
} from '../../schemas/file-history.js';
import type { IFileHistoryStorage, NewFileHistoryInsert } from '../../types/history.js';

function toInsert(row: NewFileHistoryInsert): NewFileHistoryRow {
  return {
    workspaceId: row.workspaceId,
    chatId: row.chatId,
    messageId: row.messageId,
    runId: row.runId ?? null,
    toolCallId: row.toolCallId ?? null,
    path: row.path,
    op: row.op,
    existedBefore: row.existedBefore ? 1 : 0,
    beforeHash: row.beforeHash ?? null,
    afterHash: row.afterHash,
    beforeBlob: row.beforeBlob ?? null,
    snapshotTruncated: row.snapshotTruncated === true ? 1 : 0,
    diffPreview: row.diffPreview ?? null,
  };
}

export class ColdFileHistoryStorage implements IFileHistoryStorage {
  constructor(protected readonly db: Database) {}

  async insert(row: NewFileHistoryInsert): Promise<FileHistoryRow> {
    try {
      const rows = await this.db.insert(fmFileHistory).values(toInsert(row)).returning();
      const inserted = rows[0];
      if (!inserted) {
        throw new StorageWriteError('fm_file_history insert returned no row', {
          chatId: row.chatId,
          messageId: row.messageId,
          path: row.path,
        });
      }
      return inserted;
    } catch (err) {
      if (err instanceof FmDomainError) throw err;
      throw new StorageWriteError('fm_file_history insert failed', {
        cause: err instanceof Error ? err.message : String(err),
        chatId: row.chatId,
        messageId: row.messageId,
        path: row.path,
      });
    }
  }

  /** Entries for the revert scope, oldest first (insert order). */
  async listByMessageIds(chatId: string, messageIds: string[]): Promise<FileHistoryRow[]> {
    if (messageIds.length === 0) return [];
    try {
      return await this.db
        .select()
        .from(fmFileHistory)
        .where(and(eq(fmFileHistory.chatId, chatId), inArray(fmFileHistory.messageId, messageIds)))
        .orderBy(fmFileHistory.id);
    } catch (err) {
      if (err instanceof FmDomainError) throw err;
      throw new StorageReadError('fm_file_history', err);
    }
  }

  /** Newest entry for a workspace path across all chats (collision attribution). */
  async findLatestByWorkspacePath(
    workspaceId: string,
    path: string,
  ): Promise<FileHistoryRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(fmFileHistory)
        .where(and(eq(fmFileHistory.workspaceId, workspaceId), eq(fmFileHistory.path, path)))
        .orderBy(desc(fmFileHistory.id))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof FmDomainError) throw err;
      throw new StorageReadError('fm_file_history', err);
    }
  }

  async deleteByMessageIds(chatId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.db
        .delete(fmFileHistory)
        .where(and(eq(fmFileHistory.chatId, chatId), inArray(fmFileHistory.messageId, messageIds)));
    } catch (err) {
      if (err instanceof FmDomainError) throw err;
      throw new StorageWriteError('fm_file_history delete failed', {
        cause: err instanceof Error ? err.message : String(err),
        chatId,
        messageIds,
      });
    }
  }

  async deleteByChatId(chatId: string): Promise<void> {
    try {
      await this.db.delete(fmFileHistory).where(eq(fmFileHistory.chatId, chatId));
    } catch (err) {
      if (err instanceof FmDomainError) throw err;
      throw new StorageWriteError('fm_file_history delete failed', {
        cause: err instanceof Error ? err.message : String(err),
        chatId,
      });
    }
  }
}
