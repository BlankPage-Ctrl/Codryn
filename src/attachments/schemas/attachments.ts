import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id').notNull(),
    originalFilename: text('original_filename').notNull(),
    storedFilename: text('stored_filename').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status', { enum: ['pending', 'linked'] })
      .notNull()
      .default('pending'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text('expires_at'),
  },
  (t) => [
    index('attachments_workspace_id_idx').on(t.workspaceId),
    index('attachments_status_expires_idx').on(t.status, t.expiresAt),
  ],
);

export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
