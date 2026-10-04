import type { WorkspacesRow } from '../schemas/index.js';

export interface IColdWorkspacesStorage {
  findAll(): Promise<WorkspacesRow[]>;
  findById(id: string): Promise<WorkspacesRow | null>;
  insert(row: WorkspacesRow): Promise<WorkspacesRow>;
  update(id: string, patch: Partial<WorkspacesRow>): Promise<WorkspacesRow>;
  delete(id: string): Promise<void>;
}
