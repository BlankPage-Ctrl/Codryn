import type { RunStepRow, NewRunStepRow } from '../schemas/index.js';
import type { TokenUsageSum } from './usage.js';

export interface IColdRunStepsStorage {
  insert(row: NewRunStepRow): Promise<RunStepRow>;
  listByMessageId(messageId: string): Promise<RunStepRow[]>;
  listByRunId(runId: string): Promise<RunStepRow[]>;
  listByChatId(chatId: string): Promise<RunStepRow[]>;
  sumByMessageId(messageId: string): Promise<TokenUsageSum>;
  deleteByMessageIds(messageIds: string[]): Promise<void>;
  deleteByChatId(chatId: string): Promise<void>;
}
