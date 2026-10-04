import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { messages } from './messages.js';

export const messageParts = sqliteTable(
  'message_parts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type', { length: 64 }).notNull(),
    text: text('text'),
    state: text('state', { length: 32 }),
    toolCallId: text('tool_call_id', { length: 255 }),
    inputJson: text('input_json'),
    outputJson: text('output_json'),
    errorText: text('error_text'),
    providerExecuted: integer('provider_executed', { mode: 'boolean' }),
    sourceId: text('source_id', { length: 255 }),
    url: text('url'),
    title: text('title', { length: 500 }),
    mediaType: text('media_type', { length: 128 }),
    filename: text('filename', { length: 500 }),
    dataJson: text('data_json'),
    providerMetadataJson: text('provider_metadata_json'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('message_parts_message_id_idx').on(t.messageId),
    index('message_parts_message_id_position_idx').on(t.messageId, t.position),
  ],
);

export type MessagePartRow = typeof messageParts.$inferSelect;
export type NewMessagePartRow = typeof messageParts.$inferInsert;
