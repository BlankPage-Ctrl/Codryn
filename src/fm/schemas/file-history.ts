import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Append-only ledger of AI-driven file mutations (edit_file / create_file).
 *
 * Each row captures the before-image of one tool call so a later revert can
 * restore the file wholesale (snapshot restore) instead of replaying an
 * inverse edit. Inverse edits are brittle under line shifts, duplicate
 * matches, and concurrent chats editing the same file; a snapshot is
 * deterministic.
 *
 * Revert scope is resolved via `messageId`: reverting from a user message
 * restores the oldest before-image of every path touched by the suffix
 * (deleted) messages. Conflict detection compares the live file hash against
 * the newest recorded `afterHash` - a mismatch means someone (another chat
 * or the user) changed the file after the AI, so restore is skipped unless
 * forced.
 */
export const fmFileHistory = sqliteTable(
  'fm_file_history',
  {
    // Monotonic insert order doubles as the timeline (oldest/newest per path).
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: text('workspace_id').notNull(),
    chatId: text('chat_id').notNull(),
    // Assistant message that produced the mutation.
    messageId: text('message_id').notNull(),
    runId: text('run_id', { length: 64 }),
    toolCallId: text('tool_call_id', { length: 128 }),
    // Workspace-relative path (same convention as EditFileData.path).
    path: text('path').notNull(),
    op: text('op', { length: 16 }).notNull(),
    existedBefore: integer('existed_before').notNull(),
    beforeHash: text('before_hash', { length: 64 }),
    afterHash: text('after_hash', { length: 64 }).notNull(),
    // gzip(base64) of the before-image bytes. Null when the file did not
    // exist before, or when the snapshot was too large to keep.
    beforeBlob: text('before_blob'),
    snapshotTruncated: integer('snapshot_truncated').notNull().default(0),
    // Unified diff preview for UI display (not used for restore).
    diffPreview: text('diff_preview'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index('fm_file_history_chat_id_idx').on(t.chatId),
    index('fm_file_history_message_id_idx').on(t.messageId),
    index('fm_file_history_workspace_path_idx').on(t.workspaceId, t.path),
  ],
);

export type FileHistoryRow = typeof fmFileHistory.$inferSelect;
export type NewFileHistoryRow = typeof fmFileHistory.$inferInsert;
