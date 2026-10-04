import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const messages = sqliteTable(
  'messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text('chat_id').notNull(),
    role: text('role', { length: 16 }).notNull(),
    position: integer('position').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index('messages_chat_id_idx').on(t.chatId),
    index('messages_chat_id_position_idx').on(t.chatId, t.position),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
