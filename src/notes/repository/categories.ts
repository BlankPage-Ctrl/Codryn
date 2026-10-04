import type { Category } from '../types/index.js';
import type { ICategoriesRepository } from '../types/categories-repository.js';
import type { IColdCategoriesStorage } from '../types/cold-categories-storage.js';
import { categoryInsertSchema, categorySelectSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { NotesDomainError } from '../errors/base.js';

type CategoryRow = z.infer<typeof categorySelectSchema>;

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    color: row.color,
    is_default: row.isDefault,
    created_at: new Date(row.createdAt),
  };
}

function categoryToRow(cat: Category): CategoryRow {
  return {
    id: cat.id,
    workspaceId: cat.workspace_id,
    name: cat.name,
    color: cat.color,
    isDefault: cat.is_default,
    createdAt: cat.created_at.toISOString(),
  };
}

export class CategoriesRepository implements ICategoriesRepository {
  constructor(private readonly cold: IColdCategoriesStorage) {}

  async findById(id: string): Promise<Category | null> {
    const row = await this.cold.findById(id);
    if (!row) return null;
    let validated: CategoryRow;
    try {
      validated = categorySelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid category row from storage', {
        id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToCategory(validated);
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<Category | null> {
    const row = await this.cold.findByIdAndWorkspace(id, workspaceId);
    if (!row) return null;
    let validated: CategoryRow;
    try {
      validated = categorySelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid category row from storage', {
        id,
        workspaceId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToCategory(validated);
  }

  async findByName(name: string, workspaceId: string): Promise<Category | null> {
    const row = await this.cold.findByName(name, workspaceId);
    if (!row) return null;
    let validated: CategoryRow;
    try {
      validated = categorySelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid category row from storage', {
        name,
        workspaceId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToCategory(validated);
  }

  async list(workspaceId: string): Promise<Category[]> {
    const rows = await this.cold.list(workspaceId);
    return rows.map((row) => {
      try {
        return rowToCategory(categorySelectSchema.parse(row));
      } catch (err) {
        if (err instanceof NotesDomainError) throw err;
        throw new ValidationError('Invalid category row from storage', {
          id: (row as { id?: unknown }).id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async insert(cat: Category): Promise<void> {
    const row = categoryToRow(cat);
    try {
      categoryInsertSchema.parse(row);
    } catch (err) {
      throw new ValidationError('Invalid category for insert', {
        id: cat.id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    await this.cold.insert(row);
  }

  async update(id: string, patch: Partial<Category>): Promise<Category> {
    const rowPatch: Partial<CategoryRow> = {};
    if (patch.name !== undefined) rowPatch.name = patch.name;
    if (patch.color !== undefined) rowPatch.color = patch.color;
    const updated = await this.cold.update(id, rowPatch);
    let validated: CategoryRow;
    try {
      validated = categorySelectSchema.parse(updated);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid category row after update', {
        id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToCategory(validated);
  }

  async delete(id: string): Promise<void> {
    await this.cold.delete(id);
  }

  async ensureDefault(workspaceId: string): Promise<Category> {
    const row = await this.cold.ensureDefault(workspaceId);
    let validated: CategoryRow;
    try {
      validated = categorySelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid category row from storage', {
        workspaceId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToCategory(validated);
  }
}
