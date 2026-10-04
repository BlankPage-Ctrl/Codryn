import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdRunStepsStorage } from '../../types/cold-run-steps-storage.js';
import type { TokenUsageSum } from '../../types/usage.js';
import { messageRunSteps, type RunStepRow, type NewRunStepRow } from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { MessagesDomainError } from '../../errors/base.js';
import { withBusyRetry } from '../../utils/retry.js';
import type PQueue from 'p-queue';

export class ColdRunStepsStorage implements IColdRunStepsStorage {
  constructor(
    protected readonly db: Database,
    private readonly queue?: PQueue,
  ) {}

  async insert(row: NewRunStepRow): Promise<RunStepRow> {
    try {
      const messageId = row.messageId as string;
      const stepIndex = row.stepIndex as number;
      const run = async () => {
        await this.db
          .insert(messageRunSteps)
          .values(row)
          .onConflictDoNothing({
            target: [messageRunSteps.messageId, messageRunSteps.stepIndex],
          });
      };
      if (this.queue) {
        await withBusyRetry(() => this.queue!.add(run) as Promise<void>);
      } else {
        await withBusyRetry(run);
      }
      const rows = await this.db
        .select()
        .from(messageRunSteps)
        .where(
          and(eq(messageRunSteps.messageId, messageId), eq(messageRunSteps.stepIndex, stepIndex)),
        )
        .limit(1);
      const existing = rows[0];
      if (!existing) {
        throw new StorageWriteError('message_run_steps', 'insert returned no row', {
          messageId,
          stepIndex,
        });
      }
      return existing;
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { row });
    }
  }

  async listByMessageId(messageId: string): Promise<RunStepRow[]> {
    try {
      return await this.db
        .select()
        .from(messageRunSteps)
        .where(eq(messageRunSteps.messageId, messageId))
        .orderBy(messageRunSteps.stepIndex);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_run_steps', err, { messageId });
    }
  }

  async listByRunId(runId: string): Promise<RunStepRow[]> {
    try {
      return await this.db
        .select()
        .from(messageRunSteps)
        .where(eq(messageRunSteps.runId, runId))
        .orderBy(messageRunSteps.stepIndex);
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_run_steps', err, { runId });
    }
  }

  async sumByChatId(chatId: string): Promise<TokenUsageSum> {
    try {
      // No partial select: the Database union only accepts select() without
      // args, so aggregate in JS. NULL counts as 0, matching coalesce().
      const rows = await this.db
        .select()
        .from(messageRunSteps)
        .where(eq(messageRunSteps.chatId, chatId));
      return {
        inputTokens: rows.reduce((sum, r) => sum + Number(r.inputTokens ?? 0), 0),
        outputTokens: rows.reduce((sum, r) => sum + Number(r.outputTokens ?? 0), 0),
        totalTokens: rows.reduce((sum, r) => sum + Number(r.totalTokens ?? 0), 0),
        steps: rows.length,
      };
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_run_steps', err, { chatId });
    }
  }

  async sumByMessageId(messageId: string): Promise<TokenUsageSum> {
    try {
      // No partial select: the Database union only accepts select() without
      // args, so aggregate in JS. NULL counts as 0, matching coalesce().
      const rows = await this.db
        .select()
        .from(messageRunSteps)
        .where(eq(messageRunSteps.messageId, messageId));
      return {
        inputTokens: rows.reduce((sum, r) => sum + Number(r.inputTokens ?? 0), 0),
        outputTokens: rows.reduce((sum, r) => sum + Number(r.outputTokens ?? 0), 0),
        totalTokens: rows.reduce((sum, r) => sum + Number(r.totalTokens ?? 0), 0),
        steps: rows.length,
      };
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageReadError('message_run_steps', err, { messageId });
    }
  }

  async deleteByMessageIds(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.db.delete(messageRunSteps).where(inArray(messageRunSteps.messageId, messageIds));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { messageIds });
    }
  }

  async deleteByChatId(chatId: string): Promise<void> {
    try {
      await this.db.delete(messageRunSteps).where(eq(messageRunSteps.chatId, chatId));
    } catch (err) {
      if (err instanceof MessagesDomainError) throw err;
      throw new StorageWriteError('message_run_steps', err, { chatId });
    }
  }
}
