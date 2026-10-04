import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { messages } from './messages.js';

export const messageRunSteps = sqliteTable(
  'message_run_steps',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    runId: text('run_id', { length: 64 }).notNull(),
    stepIndex: integer('step_index').notNull(),
    finishReason: text('finish_reason', { length: 32 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    modelId: text('model_id', { length: 255 }),
    providerMetadataJson: text('provider_metadata_json'),
    toolCallsJson: text('tool_calls_json'),
    startedAtMs: integer('started_at_ms'),
    finishedAtMs: integer('finished_at_ms'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index('message_run_steps_message_id_idx').on(t.messageId),
    index('message_run_steps_run_id_idx').on(t.runId),
    index('message_run_steps_chat_id_idx').on(t.chatId),
    unique('message_run_steps_message_step_uq').on(t.messageId, t.stepIndex),
  ],
);

export type RunStepRow = typeof messageRunSteps.$inferSelect;
export type NewRunStepRow = typeof messageRunSteps.$inferInsert;
