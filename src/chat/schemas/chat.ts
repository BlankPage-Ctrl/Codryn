import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const chats = sqliteTable('chats', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  systemPrompt: text('system_prompt'),
  thinkingMode: text('thinking_mode').notNull().default('default'),
  mode: text('mode').notNull().default('ask'),
  workspaceId: text('workspace_id').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type ChatRow = typeof chats.$inferSelect;
export type NewChatRow = typeof chats.$inferInsert;
