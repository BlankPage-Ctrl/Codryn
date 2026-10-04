import { type Note, type NoteFilter, type ListOpts } from '../types/index.js';
import type { INotesRepository } from '../types/notes-repository.js';
import type { IColdNotesStorage } from '../types/cold-notes-storage.js';
import { noteSelectSchema, noteInsertSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { NotesDomainError } from '../errors/base.js';

type NoteRow = z.infer<typeof noteSelectSchema>;

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    category_id: row.categoryId,
    desc: row.desc,
    details: row.details,
    rank: row.rank,
    priority: row.priority as Note['priority'],
    created_at: new Date(row.createdAt),
    updated_at: new Date(row.updatedAt),
    version: row.version,
    deleted_at: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}

function noteToRow(note: Note): NoteRow {
  return {
    id: note.id,
    workspaceId: note.workspace_id,
    name: note.name,
    categoryId: note.category_id,
    desc: note.desc,
    details: note.details,
    rank: note.rank,
    priority: note.priority as NoteRow['priority'],
    createdAt: note.created_at.toISOString(),
    updatedAt: note.updated_at.toISOString(),
    version: note.version,
    deletedAt: note.deleted_at?.toISOString() ?? null,
  };
}

function patchToRow(patch: Partial<Note>): Partial<NoteRow> {
  const row: Partial<NoteRow> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.workspace_id !== undefined) row.workspaceId = patch.workspace_id;
  if (patch.category_id !== undefined) row.categoryId = patch.category_id;
  if (patch.desc !== undefined) row.desc = patch.desc;
  if (patch.details !== undefined) row.details = patch.details;
  if (patch.rank !== undefined) row.rank = patch.rank;
  if (patch.priority !== undefined) row.priority = patch.priority as NoteRow['priority'];
  if (patch.updated_at !== undefined) row.updatedAt = patch.updated_at.toISOString();
  if (patch.version !== undefined) row.version = patch.version;
  if (patch.deleted_at !== undefined) row.deletedAt = patch.deleted_at?.toISOString() ?? null;
  return row;
}

export class NotesRepository implements INotesRepository {
  constructor(private readonly cold: IColdNotesStorage) {}

  async findById(id: string): Promise<Note | null> {
    const row = await this.cold.findById(id);
    if (!row) return null;
    let validated: NoteRow;
    try {
      validated = noteSelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid note row from storage', {
        id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToNote(validated);
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<Note | null> {
    const row = await this.cold.findByIdAndWorkspace(id, workspaceId);
    if (!row) return null;
    let validated: NoteRow;
    try {
      validated = noteSelectSchema.parse(row);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid note row from storage', {
        id,
        workspaceId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToNote(validated);
  }

  async findMany(filter: NoteFilter & { workspace_id: string }, opts: ListOpts): Promise<Note[]> {
    const rows = await this.cold.findMany({ ...filter, workspace_id: filter.workspace_id }, opts);
    return rows.map((row) => {
      try {
        return rowToNote(noteSelectSchema.parse(row));
      } catch (err) {
        if (err instanceof NotesDomainError) throw err;
        throw new ValidationError('Invalid note row from storage', {
          id: (row as { id?: unknown }).id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async insert(note: Note): Promise<void> {
    const row = noteToRow(note);
    try {
      noteInsertSchema.parse(row);
    } catch (err) {
      throw new ValidationError('Invalid note for insert', {
        id: note.id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    await this.cold.insert(row);
  }

  async update(id: string, patch: Partial<Note>): Promise<Note> {
    const rowPatch = patchToRow(patch);
    const updated = await this.cold.update(id, rowPatch);
    let validated: NoteRow;
    try {
      validated = noteSelectSchema.parse(updated);
    } catch (err) {
      if (err instanceof NotesDomainError) throw err;
      throw new ValidationError('Invalid note row after update', {
        id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToNote(validated);
  }

  async delete(id: string): Promise<void> {
    await this.cold.delete(id);
  }

  async countByCategory(categoryId: string, workspaceId: string): Promise<number> {
    return this.cold.countByCategory(categoryId, workspaceId);
  }

  async getMaxRank(workspaceId: string): Promise<string | null> {
    return this.cold.getMaxRank(workspaceId);
  }

  async reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.cold.reassignCategory(oldCategoryId, newCategoryId, workspaceId);
  }

  async renumber(
    workspaceId: string,
    updates: Array<{ id: string; rank: string; updatedAt: Date; version: number }>,
  ): Promise<void> {
    await this.cold.renumberRanks(
      updates.map((u) => ({
        id: u.id,
        rank: u.rank,
        updatedAt: u.updatedAt.toISOString(),
        version: u.version,
      })),
    );
  }
}
