import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const client = sqliteTable('client', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  secretKey: text('secret_key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type ClientRow = typeof client.$inferSelect;
export type NewClientRow = typeof client.$inferInsert;
