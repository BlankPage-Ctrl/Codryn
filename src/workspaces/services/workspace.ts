import {
  WorkspaceCreateSchema,
  WorkspaceUpdateSchema,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceUpdateInput,
  type IWorkspacesService,
} from '../types/index.js';
import type { IWorkspacesRepository } from '../types/workspaces-repository.js';
import { ValidationError } from '../errors/validation.js';
import { WorkspaceNotFoundError } from '../errors/not-found.js';

export class WorkspacesService implements IWorkspacesService {
  constructor(private readonly repo: IWorkspacesRepository) {}

  async findAll(): Promise<Workspace[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Workspace> {
    const ws = await this.repo.findById(id);
    if (!ws) throw new WorkspaceNotFoundError(id);
    return ws;
  }

  async create(input: WorkspaceCreateInput): Promise<Workspace> {
    const parsed = WorkspaceCreateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid workspace: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, input },
      );
    }
    return this.repo.create(parsed.data);
  }

  async update(id: string, input: WorkspaceUpdateInput): Promise<Workspace> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new WorkspaceNotFoundError(id);

    const parsed = WorkspaceUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid workspace update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id, input },
      );
    }
    return this.repo.update(id, parsed.data);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new WorkspaceNotFoundError(id);
    await this.repo.remove(id);
  }
}
