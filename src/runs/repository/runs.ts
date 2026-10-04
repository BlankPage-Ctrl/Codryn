import { z } from 'zod';
import type { RunRecord } from '../types/index.js';
import type { IRunRepository, IRunStorage } from '../types/index.js';
import { RunInvalidError } from '../errors/validation.js';

const RunStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled']);

const RunRecordSchema = z.object({
  runId: z.string().min(1),
  chatId: z.string().min(1),
  workspaceId: z.string().min(1),
  assistantMessageId: z.string().min(1),
  status: RunStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z
    .object({ code: z.string(), message: z.string(), details: z.unknown().optional() })
    .optional(),
  pendingApproval: z.unknown().optional().nullable(),
});

const RunIdSchema = z.string().min(1);

function parseRecord(row: unknown, context?: Record<string, unknown>): RunRecord {
  const parsed = RunRecordSchema.safeParse(row);
  if (!parsed.success) {
    throw new RunInvalidError(
      `Invalid run record: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      { ...context, issues: parsed.error.issues },
    );
  }
  return parsed.data as RunRecord;
}

export class RunsRepository implements IRunRepository {
  constructor(private readonly hot: IRunStorage) {}

  async get(runId: string): Promise<RunRecord | null> {
    const id = RunIdSchema.parse(runId);
    const row = await this.hot.get(id);
    if (!row) return null;
    return parseRecord(row, { runId: id });
  }

  async save(record: RunRecord): Promise<RunRecord> {
    const parsed = parseRecord(record, { runId: record.runId });
    await this.hot.set(parsed);
    const reread = await this.hot.get(parsed.runId);
    if (!reread) return parsed;
    return parseRecord(reread, { runId: parsed.runId });
  }

  async remove(runId: string): Promise<void> {
    const id = RunIdSchema.parse(runId);
    await this.hot.delete(id);
  }

  async listByChat(chatId: string): Promise<RunRecord[]> {
    const id = RunIdSchema.parse(chatId);
    const rows = await this.hot.listByChat(id);
    return rows.map((row) => parseRecord(row, { chatId: id }));
  }
}
