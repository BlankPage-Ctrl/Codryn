import type { Workspace, WorkspaceCreateInput, WorkspaceUpdateInput } from './workspace.js';

export interface IWorkspacesService {
  findAll(): Promise<Workspace[]>;
  findOne(id: string): Promise<Workspace>;
  create(input: WorkspaceCreateInput): Promise<Workspace>;
  update(id: string, input: WorkspaceUpdateInput): Promise<Workspace>;
  remove(id: string): Promise<void>;
}
