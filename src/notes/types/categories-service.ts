import type { Category, CategoryCreateInput } from './category.js';

export interface ICategoriesService {
  list(workspaceId: string): Promise<Category[]>;
  create(
    workspaceId: string,
    input: Omit<CategoryCreateInput, 'workspace_id'> & { workspace_id?: string },
  ): Promise<Category>;
  rename(id: string, workspaceId: string, name: string): Promise<Category>;
  delete(id: string, workspaceId: string): Promise<void>;
  findById(id: string, workspaceId: string): Promise<Category | null>;
  ensureDefault(workspaceId: string): Promise<Category>;
}
