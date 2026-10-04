import type { UIMessage } from 'ai';
import {
  AppendMessageSchema,
  ChatIdSchema,
  DeleteMessageSchema,
  RecordRunStepSchema,
  RevertMessageSchema,
  type RecordRunStepInput,
} from '../types/index.js';
import type { HistoryThreadMessage, RevertFromMessageResult, RevertScope } from '../types/index.js';
import type { ChatTokenUsage, MessageTokenUsage } from '../types/usage.js';
import type { RunStepRow, NewRunStepRow } from '../types/run-step.js';
import { ValidationError } from '../errors/validation.js';
import type { IMessagesRepository } from '../types/messages-repository.js';
import type {
  IStreamingPersister,
  StreamingPersisterOptions,
} from '../types/streaming-persister.js';
import { StreamingPersister } from './streaming-persister.js';

export class MessagesService {
  constructor(private readonly repo: IMessagesRepository) {}

  async load(chatId: string): Promise<UIMessage[]> {
    const parsed = ChatIdSchema.safeParse({ chatId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chatId: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId },
      );
    }
    return this.repo.findByChatId(parsed.data.chatId);
  }

  /**
   * Raw history thread for frontend replay: message rows with their stored
   * part rows (dataJson intact) plus run steps for assistant messages.
   * Unlike load(), the result is NOT a UIMessage - it never enters model
   * input. N+1 step queries per assistant message.
   */
  async loadHistory(chatId: string): Promise<HistoryThreadMessage[]> {
    const parsed = ChatIdSchema.safeParse({ chatId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chatId: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId },
      );
    }
    const grouped = await this.repo.findHistory(parsed.data.chatId);
    const out: HistoryThreadMessage[] = [];
    for (const msg of grouped) {
      const steps = msg.role === 'assistant' ? await this.repo.listRunStepsByMessage(msg.id) : [];
      out.push({
        ...msg,
        steps: [...steps].sort((a, b) => a.stepIndex - b.stepIndex),
      });
    }
    return out;
  }

  async append(chatId: string, message: UIMessage): Promise<void> {
    const parsed = AppendMessageSchema.safeParse({
      chatId,
      id: message.id,
      role: message.role,
    });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid message: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId, messageId: message.id },
      );
    }
    await this.repo.append(parsed.data.chatId, message);
  }

  createStreamingPersister(
    options: Omit<StreamingPersisterOptions, 'repo'>,
    logError: (err: unknown) => void = () => {},
  ): IStreamingPersister {
    return new StreamingPersister(this.repo, options, logError);
  }

  async recordRunStep(input: RecordRunStepInput): Promise<RunStepRow> {
    const parsed = RecordRunStepSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid run step: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    const row: NewRunStepRow = {
      messageId: parsed.data.messageId,
      chatId: parsed.data.chatId,
      runId: parsed.data.runId,
      stepIndex: parsed.data.stepIndex,
      finishReason: parsed.data.finishReason ?? null,
      inputTokens: parsed.data.inputTokens ?? null,
      outputTokens: parsed.data.outputTokens ?? null,
      totalTokens: parsed.data.totalTokens ?? null,
      modelId: parsed.data.modelId ?? null,
      providerMetadataJson: parsed.data.providerMetadataJson ?? null,
      toolCallsJson: parsed.data.toolCallsJson ?? null,
      startedAtMs: parsed.data.startedAtMs ?? null,
      finishedAtMs: parsed.data.finishedAtMs ?? null,
    };
    return this.repo.recordRunStep(row);
  }

  async listRunStepsByMessage(messageId: string): Promise<RunStepRow[]> {
    if (!messageId) {
      throw new ValidationError('Invalid messageId', { messageId });
    }
    return this.repo.listRunStepsByMessage(messageId);
  }

  async listRunStepsByRun(runId: string): Promise<RunStepRow[]> {
    if (!runId) {
      throw new ValidationError('Invalid runId', { runId });
    }
    return this.repo.listRunStepsByRun(runId);
  }

  async getUsageByChat(chatId: string): Promise<ChatTokenUsage> {
    const parsed = ChatIdSchema.safeParse({ chatId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chatId: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId },
      );
    }
    return this.repo.getUsageByChat(parsed.data.chatId);
  }

  async getUsageByMessage(messageId: string): Promise<MessageTokenUsage> {
    if (!messageId) {
      throw new ValidationError('Invalid messageId', { messageId });
    }
    return this.repo.getUsageByMessage(messageId);
  }

  async clear(chatId: string): Promise<void> {
    const parsed = ChatIdSchema.safeParse({ chatId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chatId: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId },
      );
    }
    await this.repo.deleteByChatId(parsed.data.chatId);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    const parsed = DeleteMessageSchema.safeParse({ chatId, id: messageId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid message: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId, messageId },
      );
    }
    await this.repo.deleteMessage(parsed.data.chatId, parsed.data.id);
  }

  async computeRevertScope(chatId: string, messageId: string): Promise<RevertScope> {
    const parsed = RevertMessageSchema.safeParse({ chatId, id: messageId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid revert target: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId, messageId },
      );
    }
    return this.repo.computeRevertScope(parsed.data.chatId, parsed.data.id);
  }

  async revertFromMessage(chatId: string, messageId: string): Promise<RevertFromMessageResult> {
    const parsed = RevertMessageSchema.safeParse({ chatId, id: messageId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid revert target: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId, messageId },
      );
    }
    return this.repo.revertFromMessage(parsed.data.chatId, parsed.data.id);
  }
}
