import type { Workspace, WorkspaceCreateInput, WorkspaceUpdateInput } from './workspace.js';

export interface IWorkspacesRepository {
  findAll(): Promise<Workspace[]>;
  findById(id: string): Promise<Workspace | null>;
  create(data: WorkspaceCreateInput): Promise<Workspace>;
  update(id: string, data: WorkspaceUpdateInput): Promise<Workspace>;
  remove(id: string): Promise<void>;
}
