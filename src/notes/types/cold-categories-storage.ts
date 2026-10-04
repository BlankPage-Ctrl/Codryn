import type { CategoryRow } from '../schemas/index.js';

export interface IColdCategoriesStorage {
  findById(id: string): Promise<CategoryRow | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<CategoryRow | null>;
  findByName(name: string, workspaceId: string): Promise<CategoryRow | null>;
  list(workspaceId: string): Promise<CategoryRow[]>;
  insert(row: CategoryRow): Promise<void>;
  update(id: string, patch: Partial<CategoryRow>): Promise<CategoryRow>;
  delete(id: string): Promise<void>;
  ensureDefault(workspaceId: string): Promise<CategoryRow>;
}
