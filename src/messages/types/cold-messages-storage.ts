import type { MessageRow, NewMessageRow } from '../schemas/index.js';

export interface IColdMessagesStorage {
  findByChatId(chatId: string): Promise<MessageRow[]>;
  findById(id: string): Promise<MessageRow | null>;
  insert(row: NewMessageRow): Promise<MessageRow>;
  deleteById(chatId: string, messageId: string): Promise<void>;
  deleteByIds(chatId: string, messageIds: string[]): Promise<void>;
  deleteByChatId(chatId: string): Promise<void>;
  getMaxPosition(chatId: string): Promise<number | null>;
}
