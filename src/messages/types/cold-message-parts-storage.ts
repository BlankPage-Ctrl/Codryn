import type { MessagePartRow, NewMessagePartRow } from '../schemas/index.js';

export type MessagePartUpdateRow = Partial<MessagePartRow> & { id: string };

export interface IColdMessagePartsStorage {
  findByMessageIds(messageIds: string[]): Promise<MessagePartRow[]>;
  findByMessageId(messageId: string): Promise<MessagePartRow[]>;
  insertMany(rows: NewMessagePartRow[]): Promise<void>;
  updateMany(rows: MessagePartUpdateRow[]): Promise<void>;
  deleteByMessageIds(messageIds: string[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  deleteByChatId(chatId: string): Promise<void>;
}
