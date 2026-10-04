import { z } from 'zod';
import type {
  MessageRow,
  MessagePartRow,
  NewMessageRow,
  NewMessagePartRow,
} from '../schemas/index.js';
import type { RunStepRow } from '../schemas/index.js';
import { messageInsertSchema } from '../schemas/zod/index.js';

export type { MessageRow, MessagePartRow, NewMessageRow, NewMessagePartRow };

export type MessageWithParts = MessageRow & { parts: MessagePartRow[] };
export type MessageEntity = NewMessageRow & { parts: NewMessagePartRow[] };

export const ChatIdSchema = messageInsertSchema.pick({ chatId: true });

export const AppendMessageSchema = z.object({
  chatId: z.string().min(1),
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
});

export type AppendMessageInput = z.infer<typeof AppendMessageSchema>;

export const DeleteMessageSchema = AppendMessageSchema.pick({ chatId: true, id: true });

export type DeleteMessageInput = z.infer<typeof DeleteMessageSchema>;

export const RevertMessageSchema = AppendMessageSchema.pick({ chatId: true, id: true });

export type RevertMessageInput = z.infer<typeof RevertMessageSchema>;

export interface HistoryMessageParts {
  id: string;
  role: string;
  parts: MessagePartRow[];
}

export interface HistoryThreadMessage extends HistoryMessageParts {
  steps: RunStepRow[];
}
