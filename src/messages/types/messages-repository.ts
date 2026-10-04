import type { UIMessage } from 'ai';
import type {
  MessagePartRow,
  MessageRow,
  NewMessagePartRow,
  HistoryMessageParts,
} from './message.js';
import type { NewRunStepRow, RunStepRow } from './run-step.js';
import type { ChatTokenUsage, MessageTokenUsage } from './usage.js';

export interface IMessagesRepository {
  findByChatId(chatId: string): Promise<UIMessage[]>;
  findHistory(chatId: string): Promise<HistoryMessageParts[]>;
  append(chatId: string, message: UIMessage): Promise<void>;
  ensureMessage(
    chatId: string,
    messageId: string,
    role: UIMessage['role'],
    position?: number,
  ): Promise<MessageRow>;
  findPartsByMessageId(messageId: string): Promise<MessagePartRow[]>;
  persistParts(rows: NewMessagePartRow[]): Promise<void>;
  updateParts(rows: NewMessagePartRow[]): Promise<void>;
  reconcileParts(messageId: string, finalRows: NewMessagePartRow[]): Promise<void>;
  recordRunStep(row: NewRunStepRow): Promise<RunStepRow>;
  listRunStepsByMessage(messageId: string): Promise<RunStepRow[]>;
  listRunStepsByRun(runId: string): Promise<RunStepRow[]>;
  getUsageByChat(chatId: string): Promise<ChatTokenUsage>;
  getUsageByMessage(messageId: string): Promise<MessageTokenUsage>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  /**
   * Read-only revert scope: the target user message plus every message
   * after it, without deleting anything. Used by revert previews.
   */
  computeRevertScope(chatId: string, messageId: string): Promise<RevertScope>;
  revertFromMessage(chatId: string, messageId: string): Promise<RevertFromMessageResult>;
  deleteByChatId(chatId: string): Promise<void>;
}

export interface RevertFromMessageResult {
  deletedMessageIds: string[];
  fromPosition: number;
}

export interface RevertScope {
  targetMessageId: string;
  fromPosition: number;
  suffixIds: string[];
}
