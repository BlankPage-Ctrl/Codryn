import type { Note, NoteFilter, ListOpts } from './note.js';

export interface INotesRepository {
  findById(id: string): Promise<Note | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<Note | null>;
  findMany(filter: NoteFilter & { workspace_id: string }, opts: ListOpts): Promise<Note[]>;
  insert(note: Note): Promise<void>;
  update(id: string, patch: Partial<Note>): Promise<Note>;
  delete(id: string): Promise<void>;
  countByCategory(categoryId: string, workspaceId: string): Promise<number>;
  getMaxRank(workspaceId: string): Promise<string | null>;
  reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void>;
  renumber(
    workspaceId: string,
    updates: Array<{ id: string; rank: string; updatedAt: Date; version: number }>,
  ): Promise<void>;
}
