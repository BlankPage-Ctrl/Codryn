import type { Category } from './category.js';

export interface ICategoriesRepository {
  findById(id: string): Promise<Category | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<Category | null>;
  findByName(name: string, workspaceId: string): Promise<Category | null>;
  list(workspaceId: string): Promise<Category[]>;
  insert(cat: Category): Promise<void>;
  update(id: string, patch: Partial<Category>): Promise<Category>;
  delete(id: string): Promise<void>;
  ensureDefault(workspaceId: string): Promise<Category>;
}
