import { eq, and, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdNotesStorage } from '../../types/cold-notes-storage.js';
import { notes, type NoteRow } from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { NoteNotFoundError } from '../../errors/not-found.js';
import { NotesDomainError } from '../../errors/base.js';

export class ColdNotesStorage implements IColdNotesStorage {
  constructor(protected readonly db: Database) {}

  async findById(id: string): Promise<NoteRow | null> {
    try {
      const rows = await this.db.select().from(notes).where(eq(notes.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('notes', err, { id });
    }
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<NoteRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('notes', err, { id, workspaceId });
    }
  }

  async findMany(
    filter: {
      workspace_id: string;
      category_id?: string;
      priority?: string | string[];
      search?: string;
      deleted?: boolean;
    },
    opts: {
      sort?: string;
      order?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<NoteRow[]> {
    const conditions: SQL[] = [eq(notes.workspaceId, filter.workspace_id)];

    if (filter.deleted === undefined || !filter.deleted) {
      conditions.push(sql`${notes.deletedAt} IS NULL`);
    }

    if (filter.category_id) {
      conditions.push(eq(notes.categoryId, filter.category_id));
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      conditions.push(sql`${notes.priority} IN ${priorities}`);
    }

    if (filter.search) {
      const q = `%${filter.search.toLowerCase()}%`;
      conditions.push(sql`(LOWER(${notes.name}) LIKE ${q} OR LOWER(${notes.desc}) LIKE ${q})`);
    }

    const sortField = opts.sort ?? 'rank';
    const sortOrder = opts.order ?? 'asc';

    const orderMap: Record<string, SQL> = {
      rank: sortOrder === 'desc' ? sql`${notes.rank} DESC` : sql`${notes.rank} ASC`,
      priority:
        sortOrder === 'desc'
          ? sql`CASE ${notes.priority} WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END DESC`
          : sql`CASE ${notes.priority} WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END ASC`,
      updated_at: sortOrder === 'desc' ? sql`${notes.updatedAt} DESC` : sql`${notes.updatedAt} ASC`,
      created_at: sortOrder === 'desc' ? sql`${notes.createdAt} DESC` : sql`${notes.createdAt} ASC`,
      name: sortOrder === 'desc' ? sql`${notes.name} DESC` : sql`${notes.name} ASC`,
    };

    const orderBy = orderMap[sortField] ?? orderMap.rank;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.db.select().from(notes);
    if (conditions.length > 0) query = query.where(and(...conditions));
    query = query.orderBy(orderBy);
    if (opts.offset) query = query.offset(opts.offset);
    if (opts.limit) query = query.limit(opts.limit);
    try {
      return await query;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('notes', err, { filter, opts });
    }
  }

  async insert(row: NoteRow): Promise<void> {
    try {
      await this.db.insert(notes).values(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('notes', err, { id: row.id });
    }
  }

  async update(id: string, patch: Partial<NoteRow>): Promise<NoteRow> {
    try {
      const rows = await this.db.update(notes).set(patch).where(eq(notes.id, id)).returning();
      if (!rows[0]) throw new NoteNotFoundError(id);
      return rows[0];
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('notes', err, { id, patch });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(notes).where(eq(notes.id, id));
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('notes', err, { id });
    }
  }

  async countByCategory(categoryId: string, workspaceId: string): Promise<number> {
    try {
      // No partial select: the Database union only accepts select() without
      // args, so count matching rows in JS with the same filter.
      const rows = await this.db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.categoryId, categoryId),
            eq(notes.workspaceId, workspaceId),
            sql`${notes.deletedAt} IS NULL`,
          ),
        );
      return rows.length;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('notes', err, { categoryId, workspaceId });
    }
  }

  async getMaxRank(workspaceId: string): Promise<string | null> {
    try {
      // No partial select: the Database union only accepts select() without
      // args. rank is a real column so the accessor below stays typed.
      const rows = await this.db
        .select()
        .from(notes)
        .where(and(sql`${notes.deletedAt} IS NULL`, eq(notes.workspaceId, workspaceId)))
        .orderBy(sql`${notes.rank} DESC`)
        .limit(1);
      return rows[0]?.rank ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('notes', err, { workspaceId });
    }
  }

  async reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void> {
    if (oldCategoryId === newCategoryId) return;
    try {
      await this.db
        .update(notes)
        .set({ categoryId: newCategoryId })
        .where(and(eq(notes.categoryId, oldCategoryId), eq(notes.workspaceId, workspaceId)));
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('notes', err, { oldCategoryId, newCategoryId, workspaceId });
    }
  }

  async renumberRanks(
    updates: Array<{ id: string; rank: string; updatedAt: string; version: number }>,
  ): Promise<void> {
    try {
      await this.db.transaction((tx) => {
        for (const u of updates) {
          tx.update(notes)
            .set({ rank: u.rank, updatedAt: u.updatedAt, version: u.version })
            .where(eq(notes.id, u.id))
            .run();
        }
      });
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('notes', err, { count: updates.length });
    }
  }
}
