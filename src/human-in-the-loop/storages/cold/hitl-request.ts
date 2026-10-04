import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdHitlStorage } from '../../types/cold-hitl-storage.js';
import {
  hitlRequests,
  type HitlRequestRow,
  type NewHitlRequestRow,
  type HitlRequestPatchRow,
} from '../../schemas/index.js';
import { HitlDomainError } from '../../errors/base.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { HitlRequestNotFoundError } from '../../errors/not-found.js';
import { withBusyRetry } from '../../utils/retry.js';
import type PQueue from 'p-queue';

export class ColdHitlStorage implements IColdHitlStorage {
  constructor(
    protected readonly db: Database,
    private readonly queue?: PQueue,
  ) {}

  async findById(id: string): Promise<HitlRequestRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(hitlRequests)
        .where(eq(hitlRequests.id, id))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof HitlDomainError) throw err;
      throw new StorageReadError('hitl_requests', err, { id });
    }
  }

  async findManyByStatus(status: string): Promise<HitlRequestRow[]> {
    try {
      return await this.db
        .select()
        .from(hitlRequests)
        .where(eq(hitlRequests.status, status as HitlRequestRow['status']));
    } catch (err) {
      if (err instanceof HitlDomainError) throw err;
      throw new StorageReadError('hitl_requests', err, { status });
    }
  }

  async insert(row: NewHitlRequestRow): Promise<void> {
    try {
      const run = async () => {
        await this.db.insert(hitlRequests).values(row);
      };
      if (this.queue) {
        await withBusyRetry(() => this.queue!.add(run) as Promise<void>);
      } else {
        await withBusyRetry(run);
      }
    } catch (err) {
      if (err instanceof HitlDomainError) throw err;
      throw new StorageWriteError('hitl_requests', err, { id: row.id });
    }
  }

  async update(id: string, patch: HitlRequestPatchRow): Promise<HitlRequestRow> {
    try {
      const run = async () =>
        await this.db.update(hitlRequests).set(patch).where(eq(hitlRequests.id, id)).returning();
      const rows = this.queue
        ? await withBusyRetry(() => this.queue!.add(run) as Promise<HitlRequestRow[]>)
        : await withBusyRetry(run);
      const row = rows[0];
      if (!row) {
        throw new HitlRequestNotFoundError(id);
      }
      return row;
    } catch (err) {
      if (err instanceof HitlDomainError) throw err;
      throw new StorageWriteError('hitl_requests', err, { id });
    }
  }
}
