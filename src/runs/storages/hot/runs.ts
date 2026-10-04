import type { RunRecord } from '../../types/index.js';
import type { IRunStorage } from '../../types/index.js';

export class RunHotStorage implements IRunStorage {
  private readonly records = new Map<string, RunRecord>();

  async get(runId: string): Promise<RunRecord | null> {
    return this.records.get(runId) ?? null;
  }

  async set(record: RunRecord): Promise<void> {
    this.records.set(record.runId, record);
  }

  async delete(runId: string): Promise<void> {
    this.records.delete(runId);
  }

  async listByChat(chatId: string): Promise<RunRecord[]> {
    const out: RunRecord[] = [];
    for (const record of this.records.values()) {
      if (record.chatId === chatId) out.push(record);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }
}
