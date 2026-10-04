import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const hitlRequests = sqliteTable('hitl_requests', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: text('type', { enum: ['approval', 'ask', 'choice'] }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  correlationId: text('correlation_id'),
  workspaceId: text('workspace_id'),
  chatId: text('chat_id').notNull(),
  executionId: text('execution_id'),
  metadata: text('metadata').notNull().default('{}'),
  payload: text('payload').notNull(),
  status: text('status', {
    enum: ['pending', 'resolved', 'expired', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  response: text('response'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  expiresAt: text('expires_at'),
  resolvedAt: text('resolved_at'),
});

export type HitlRequestRow = typeof hitlRequests.$inferSelect;
export type NewHitlRequestRow = typeof hitlRequests.$inferInsert;
export type HitlRequestPatchRow = Partial<NewHitlRequestRow>;
