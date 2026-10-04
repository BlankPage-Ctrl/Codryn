import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable(
  'notes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    categoryId: text('category_id').notNull(),
    desc: text('desc').notNull().default(''),
    details: text('details').notNull().default(''),
    rank: text('rank').notNull(),
    priority: text('priority', { enum: ['low', 'medium', 'high', 'critical'] })
      .notNull()
      .default('medium'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('notes_workspace_id_idx').on(table.workspaceId)],
);

export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;
