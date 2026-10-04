import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdSettingsStorage } from '../../types/cold-settings-storage.js';
import { settings, type SettingsRow } from '../../schemas/index.js';
import { SettingsDomainError } from '../../errors/base.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import type { SettingsQuery } from '../../query/settings-query.types.js';
import { buildOrderBySQL, buildWhereSQL } from '../../query/settings-query.builder.js';

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('constraint');
}

export class ColdSettingsStorage implements IColdSettingsStorage {
  constructor(protected readonly db: Database) {}

  async findOneWhere(where: { key: string }): Promise<SettingsRow | null> {
    try {
      const rows = await this.db.select().from(settings).where(eq(settings.key, where.key));
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof SettingsDomainError) throw err;
      throw new StorageReadError('settings', err, { key: where.key });
    }
  }

  async findMany(query: SettingsQuery): Promise<SettingsRow[]> {
    try {
      const where = buildWhereSQL(query.where);
      const orderBy = buildOrderBySQL(query.sort);
      // Dynamic drizzle query building with optional where/order/limit/offset
      let qb: unknown = this.db.select().from(settings);
      if (where) qb = (qb as { where: (c: unknown) => unknown }).where(where);
      if (orderBy) qb = (qb as { orderBy: (c: unknown) => unknown }).orderBy(orderBy);
      if (query.limit !== undefined)
        qb = (qb as { limit: (n: number) => unknown }).limit(query.limit);
      if (query.offset !== undefined)
        qb = (qb as { offset: (n: number) => unknown }).offset(query.offset);
      return (await (qb as Promise<SettingsRow[]>)) as SettingsRow[];
    } catch (err) {
      if (err instanceof SettingsDomainError) throw err;
      throw new StorageReadError('settings', err, { query });
    }
  }

  async count(query: SettingsQuery): Promise<number> {
    try {
      const where = buildWhereSQL(query.where);
      // No partial select: the Database union only accepts select() without
      // args (same dynamic-builder pattern as findMany above). Pagination
      // stays out of count, matching the old count(*) semantics.
      let qb: unknown = this.db.select().from(settings);
      if (where) qb = (qb as { where: (c: unknown) => unknown }).where(where);
      const rows = (await (qb as Promise<SettingsRow[]>)) as SettingsRow[];
      return rows.length;
    } catch (err) {
      if (err instanceof SettingsDomainError) throw err;
      throw new StorageReadError('settings', err, { query });
    }
  }

  async upsert(key: string, value: string, now: string): Promise<SettingsRow> {
    const existing = await this.findOneWhere({ key });

    if (existing) {
      try {
        const rows = await this.db
          .update(settings)
          .set({ value, updatedAt: now })
          .where(eq(settings.key, key))
          .returning();
        if (!rows[0]) throw new StorageWriteError('settings', 'empty returning', { key });
        return rows[0];
      } catch (err) {
        if (err instanceof SettingsDomainError) throw err;
        throw new StorageWriteError('settings', err, { key });
      }
    }

    try {
      const rows = await this.db
        .insert(settings)
        .values({ key, value, createdAt: now, updatedAt: now })
        .returning();
      if (!rows[0]) throw new StorageWriteError('settings', 'empty returning', { key });
      return rows[0];
    } catch (err) {
      if (err instanceof SettingsDomainError) throw err;
      if (isUniqueViolation(err)) {
        // Race: a concurrent upsert inserted the same key first -> fall back to update once
        try {
          const rows = await this.db
            .update(settings)
            .set({ value, updatedAt: now })
            .where(eq(settings.key, key))
            .returning();
          if (!rows[0])
            throw new StorageWriteError('settings', 'empty returning after race retry', { key });
          return rows[0];
        } catch (retryErr) {
          if (retryErr instanceof SettingsDomainError) throw retryErr;
          throw new StorageWriteError('settings', retryErr, { key });
        }
      }
      throw new StorageWriteError('settings', err, { key });
    }
  }
}
