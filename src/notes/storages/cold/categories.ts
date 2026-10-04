import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdCategoriesStorage } from '../../types/cold-categories-storage.js';
import { categories, type CategoryRow } from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { CategoryNotFoundError } from '../../errors/not-found.js';
import { NotesDomainError } from '../../errors/base.js';

const ANOTHER_CATEGORY_ID_PREFIX = 'cat:default:another';

function anotherCategoryId(workspaceId: string): string {
  return `${ANOTHER_CATEGORY_ID_PREFIX}:${workspaceId}`;
}

export class ColdCategoriesStorage implements IColdCategoriesStorage {
  constructor(protected readonly db: Database) {}

  async findById(id: string): Promise<CategoryRow | null> {
    try {
      const rows = await this.db.select().from(categories).where(eq(categories.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('categories', err, { id });
    }
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<CategoryRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('categories', err, { id, workspaceId });
    }
  }

  async findByName(name: string, workspaceId: string): Promise<CategoryRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.workspaceId, workspaceId),
            sql`LOWER(${categories.name}) = ${name.toLowerCase()}`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('categories', err, { name, workspaceId });
    }
  }

  async list(workspaceId: string): Promise<CategoryRow[]> {
    try {
      return await this.db.select().from(categories).where(eq(categories.workspaceId, workspaceId));
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageReadError('categories', err, { workspaceId });
    }
  }

  async insert(row: CategoryRow): Promise<void> {
    try {
      await this.db.insert(categories).values(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('categories', err, { id: row.id, workspaceId: row.workspaceId });
    }
  }

  async update(id: string, patch: Partial<CategoryRow>): Promise<CategoryRow> {
    try {
      const rows = await this.db
        .update(categories)
        .set(patch)
        .where(eq(categories.id, id))
        .returning();
      if (!rows[0]) throw new CategoryNotFoundError(id);
      return rows[0];
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('categories', err, { id, patch });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(categories).where(eq(categories.id, id));
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('categories', err, { id });
    }
  }

  async ensureDefault(workspaceId: string): Promise<CategoryRow> {
    const existing = await this.findByName('Another', workspaceId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row: CategoryRow = {
      id: anotherCategoryId(workspaceId),
      workspaceId,
      name: 'Another',
      color: null,
      isDefault: true,
      createdAt: now,
    };
    try {
      await this.insert(row);
      return row;
    } catch (err) {
      // Race? another concurrent ensureDefault inserted same id -> re-fetch
      if (err instanceof StorageWriteError) {
        const msg = (err.details as { cause?: unknown } | undefined)?.cause;
        const causeMsg = msg instanceof Error ? msg.message : String(msg ?? err.message);
        if (
          causeMsg.includes('UNIQUE') ||
          causeMsg.includes('unique') ||
          causeMsg.includes('constraint')
        ) {
          const retry = await this.findByName('Another', workspaceId);
          if (retry) return retry;
        }
      }
      if (err instanceof NotesDomainError) throw err;
      throw new StorageWriteError('categories', err, { workspaceId });
    }
  }
}
