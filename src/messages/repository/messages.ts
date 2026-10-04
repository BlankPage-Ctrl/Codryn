import type { UIMessage } from 'ai';
import {
  messageInsertSchema,
  messagePartInsertSchema,
  messageSelectSchema,
  messagePartSelectSchema,
  runStepInsertSchema,
  runStepSelectSchema,
} from '../schemas/zod/index.js';
import type { IMessagesRepository } from '../types/messages-repository.js';
import type { IColdMessagesStorage } from '../types/cold-messages-storage.js';
import type { IColdMessagePartsStorage } from '../types/cold-message-parts-storage.js';
import type { IColdRunStepsStorage } from '../types/cold-run-steps-storage.js';
import {
  UIMessageMapper,
  MessageAssembler,
  indexRichByCallId,
  sanitizeFinalPart,
} from '../engines/index.js';
import type {
  NewMessageRow,
  NewMessagePartRow,
  MessageRow,
  MessagePartRow,
  HistoryMessageParts,
} from '../types/message.js';
import { RevertMessageSchema } from '../types/message.js';
import type { NewRunStepRow, RunStepRow } from '../types/run-step.js';
import type { ChatTokenUsage, MessageTokenUsage } from '../types/usage.js';
import type { RevertFromMessageResult, RevertScope } from '../types/messages-repository.js';
import { ValidationError } from '../errors/validation.js';
import { StorageWriteError } from '../errors/storage.js';
import { MessagesDomainError } from '../errors/base.js';

export class MessagesRepository implements IMessagesRepository {
  constructor(
    private readonly coldMessages: IColdMessagesStorage,
    private readonly coldParts: IColdMessagePartsStorage,
    private readonly coldRunSteps: IColdRunStepsStorage,
  ) {}

  async findByChatId(chatId: string): Promise<UIMessage[]> {
    const grouped = await this.loadGrouped(chatId);

    const assembler = new MessageAssembler();
    for (const row of grouped) {
      const parts = row.parts.map((p) => UIMessageMapper.entityToPart(p));
      try {
        assembler.addMessage({
          id: row.id,
          role: row.role as UIMessage['role'],
          parts,
        });
      } catch (err) {
        // Assembler throws domain error already - propagate, otherwise enrich
        if (err instanceof MessagesDomainError) throw err;
        throw new ValidationError(err instanceof Error ? err.message : String(err), {
          messageId: row.id,
        });
      }
    }

    return assembler.resolve();
  }

  async findHistory(chatId: string): Promise<HistoryMessageParts[]> {
    return this.loadGrouped(chatId);
  }

  private async loadGrouped(
    chatId: string,
  ): Promise<Array<{ id: string; role: string; parts: MessagePartRow[] }>> {
    const rows = await this.coldMessages.findByChatId(chatId);

    if (rows.length === 0) return [];

    const messageIds = rows.map((r) => r.id);
    const allParts = await this.coldParts.findByMessageIds(messageIds);

    const partsByMsgId = new Map<string, MessagePartRow[]>();
    for (const part of allParts) {
      let parsed: MessagePartRow;
      try {
        parsed = messagePartSelectSchema.parse(part);
      } catch (err) {
        throw new ValidationError('Invalid message part row from storage', {
          partId: (part as { id?: unknown }).id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
      const list = partsByMsgId.get(parsed.messageId) ?? [];
      list.push(parsed);
      partsByMsgId.set(parsed.messageId, list);
    }

    return rows.map((row) => {
      let msg: MessageRow;
      try {
        msg = messageSelectSchema.parse(row);
      } catch (err) {
        throw new ValidationError('Invalid message row from storage', {
          rowId: row.id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
      const parts = (partsByMsgId.get(row.id) ?? []).sort((a, b) => a.position - b.position);
      return { id: msg.id, role: msg.role, parts };
    });
  }

  async append(chatId: string, message: UIMessage): Promise<void> {
    const maxPos = await this.coldMessages.getMaxPosition(chatId);
    const nextPosition = (maxPos ?? -1) + 1;

    const [entity] = UIMessageMapper.toEntities([message], chatId);
    entity.position = nextPosition;

    const msgRow: NewMessageRow = entity;
    let validatedMsg: NewMessageRow;
    try {
      validatedMsg = messageInsertSchema.parse(msgRow);
    } catch (err) {
      throw new ValidationError('Invalid message for append', {
        chatId,
        messageId: message.id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    let inserted: MessageRow;
    try {
      inserted = await this.coldMessages.insert(validatedMsg);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageId: message.id });
    }

    const partRows: NewMessagePartRow[] = entity.parts.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      messageId: inserted.id,
    }));

    if (partRows.length > 0) {
      let validatedParts: NewMessagePartRow[];
      try {
        validatedParts = partRows.map((p) => messagePartInsertSchema.parse(p));
      } catch (err) {
        throw new ValidationError('Invalid message parts for append', {
          chatId,
          messageId: inserted.id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        await this.coldParts.insertMany(validatedParts);
      } catch (err) {
        if (err instanceof MessagesDomainError) throw err;
        throw new StorageWriteError('message_parts', err, { chatId, messageId: inserted.id });
      }
    }
  }

  async ensureMessage(
    chatId: string,
    messageId: string,
    role: UIMessage['role'],
    position?: number,
  ): Promise<MessageRow> {
    const existing = await this.coldMessages.findById(messageId);
    if (existing) return existing;

    const maxPos = await this.coldMessages.getMaxPosition(chatId);
    const nextPosition = position ?? (maxPos ?? -1) + 1;

    let validated: NewMessageRow;
    try {
      validated = messageInsertSchema.parse({
        id: messageId,
        chatId,
        role,
        position: nextPosition,
        metadataJson: null,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new ValidationError('Invalid message for ensureMessage', {
        chatId,
        messageId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      return await this.coldMessages.insert(validated);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageId });
    }
  }

  async findPartsByMessageId(messageId: string): Promise<MessagePartRow[]> {
    const rows = await this.coldParts.findByMessageId(messageId);
    return rows.map((p) => {
      try {
        return messagePartSelectSchema.parse(p);
      } catch (err) {
        throw new ValidationError('Invalid message part row from storage', {
          partId: (p as { id?: unknown }).id,
          messageId,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async persistParts(rows: NewMessagePartRow[]): Promise<void> {
    if (rows.length === 0) return;
    let validated: NewMessagePartRow[];
    try {
      validated = rows.map((p) => messagePartInsertSchema.parse(p));
    } catch (err) {
      throw new ValidationError('Invalid parts for persistParts', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await this.coldParts.insertMany(validated);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err);
    }
  }

  async updateParts(rows: NewMessagePartRow[]): Promise<void> {
    if (rows.length === 0) return;
    let updateRows: ReturnType<typeof messagePartUpdateRow>[];
    try {
      updateRows = rows.map((p) => messagePartUpdateRow(p));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    try {
      await this.coldParts.updateMany(updateRows);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err);
    }
  }

  async reconcileParts(messageId: string, finalRows: NewMessagePartRow[]): Promise<void> {
    const existing = await this.coldParts.findByMessageId(messageId);
    const richByCallId = indexRichByCallId(existing);
    const sanitized = finalRows.map((part) => sanitizeFinalPart(part, richByCallId));
    const diff = new MessageAssembler().reconcile(
      existing.map((r) => ({ position: r.position, id: r.id })),
      sanitized,
    );

    if (diff.inserts.length > 0) {
      await this.persistParts(diff.inserts.map((d) => d.part));
    }
    if (diff.updates.length > 0) {
      const byPosition = new Map(existing.map((r) => [r.position, r]));
      const updatesWithIds = diff.updates.map((d) => {
        const existingRow = byPosition.get(d.position);
        if (!existingRow) {
          throw new ValidationError('reconcileParts: existing part not found for position', {
            position: d.position,
            messageId,
          });
        }
        return { ...d.part, id: existingRow.id };
      });
      await this.updateParts(updatesWithIds);
    }
    if (diff.deletes.length > 0) {
      try {
        await this.coldParts.deleteByIds(diff.deletes.map((d) => d.id));
      } catch (err) {
        if (err instanceof MessagesDomainError) throw err;
        throw new StorageWriteError('message_parts', err, { messageId });
      }
    }
  }

  async recordRunStep(row: NewRunStepRow): Promise<RunStepRow> {
    let validated: NewRunStepRow;
    try {
      validated = runStepInsertSchema.parse(row);
    } catch (err) {
      throw new ValidationError('Invalid run step for recordRunStep', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      const inserted = await this.coldRunSteps.insert(validated);
      return runStepSelectSchema.parse(inserted);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, {
        messageId: validated.messageId,
        stepIndex: validated.stepIndex,
      });
    }
  }

  async listRunStepsByMessage(messageId: string): Promise<RunStepRow[]> {
    if (!messageId) {
      throw new ValidationError('Invalid messageId for listRunStepsByMessage', { messageId });
    }
    const rows = await this.coldRunSteps.listByMessageId(messageId);
    return rows.map((p) => {
      try {
        return runStepSelectSchema.parse(p);
      } catch (err) {
        throw new ValidationError('Invalid run step row from storage', {
          messageId,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async listRunStepsByRun(runId: string): Promise<RunStepRow[]> {
    if (!runId) {
      throw new ValidationError('Invalid runId for listRunStepsByRun', { runId });
    }
    const rows = await this.coldRunSteps.listByRunId(runId);
    return rows.map((p) => {
      try {
        return runStepSelectSchema.parse(p);
      } catch (err) {
        throw new ValidationError('Invalid run step row from storage', {
          runId,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async getUsageByChat(chatId: string): Promise<ChatTokenUsage> {
    if (!chatId) {
      throw new ValidationError('Invalid chatId for getUsageByChat', { chatId });
    }
    const sum = await this.coldRunSteps.sumByChatId(chatId);
    return { chatId, ...sum };
  }

  async getUsageByMessage(messageId: string): Promise<MessageTokenUsage> {
    if (!messageId) {
      throw new ValidationError('Invalid messageId for getUsageByMessage', { messageId });
    }
    const sum = await this.coldRunSteps.sumByMessageId(messageId);
    return { messageId, ...sum };
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    try {
      await this.coldRunSteps.deleteByMessageIds([messageId]);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { chatId, messageId });
    }
    try {
      await this.coldMessages.deleteById(chatId, messageId);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageId });
    }
  }

  async computeRevertScope(chatId: string, messageId: string): Promise<RevertScope> {
    const parsed = RevertMessageSchema.safeParse({ chatId, id: messageId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid revert target: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, chatId, messageId },
      );
    }
    const rows = await this.coldMessages.findByChatId(parsed.data.chatId);
    const ordered: MessageRow[] = [];
    for (const row of rows) {
      try {
        ordered.push(messageSelectSchema.parse(row));
      } catch (err) {
        throw new ValidationError('Invalid message row from storage', {
          rowId: row.id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const target = ordered.find((r) => r.id === parsed.data.id);
    if (!target) {
      throw new ValidationError('Revert target message not found in chat', {
        chatId: parsed.data.chatId,
        messageId: parsed.data.id,
      });
    }
    if (target.role !== 'user') {
      throw new ValidationError('Revert target must be a user message', {
        chatId: parsed.data.chatId,
        messageId: parsed.data.id,
        role: target.role,
      });
    }
    const suffixIds = ordered.filter((r) => r.position >= target.position).map((r) => r.id);
    return { targetMessageId: target.id, fromPosition: target.position, suffixIds };
  }

  async revertFromMessage(chatId: string, messageId: string): Promise<RevertFromMessageResult> {
    const scope = await this.computeRevertScope(chatId, messageId);
    const suffixIds = scope.suffixIds;
    try {
      await this.coldRunSteps.deleteByMessageIds(suffixIds);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { chatId, messageId });
    }
    try {
      await this.coldParts.deleteByMessageIds(suffixIds);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { chatId, messageId });
    }
    try {
      await this.coldMessages.deleteByIds(chatId, suffixIds);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId, messageId });
    }
    return { deletedMessageIds: suffixIds, fromPosition: scope.fromPosition };
  }

  async deleteByChatId(chatId: string): Promise<void> {
    try {
      await this.coldRunSteps.deleteByChatId(chatId);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { chatId });
    }
    try {
      await this.coldParts.deleteByChatId(chatId);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_parts', err, { chatId });
    }
    try {
      await this.coldMessages.deleteByChatId(chatId);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('messages', err, { chatId });
    }
  }
}

function messagePartUpdateRow(row: NewMessagePartRow) {
  const { id, ...fields } = row;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) clean[key] = value;
  }
  if (typeof id !== 'string') {
    throw new ValidationError('messagePartUpdateRow: part row is missing an id', {
      row,
    });
  }
  return { ...clean, id };
}
