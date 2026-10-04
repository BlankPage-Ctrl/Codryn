import type { NoteRow } from '../schemas/index.js';

export interface IColdNotesStorage {
  findById(id: string): Promise<NoteRow | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<NoteRow | null>;
  findMany(
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
  ): Promise<NoteRow[]>;
  insert(row: NoteRow): Promise<void>;
  update(id: string, patch: Partial<NoteRow>): Promise<NoteRow>;
  delete(id: string): Promise<void>;
  countByCategory(categoryId: string, workspaceId: string): Promise<number>;
  getMaxRank(workspaceId: string): Promise<string | null>;
  reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void>;
  renumberRanks(
    updates: Array<{ id: string; rank: string; updatedAt: string; version: number }>,
  ): Promise<void>;
}
