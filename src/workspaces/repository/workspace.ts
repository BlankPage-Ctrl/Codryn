import type { Workspace, WorkspaceCreateInput, WorkspaceUpdateInput } from '../types/workspace.js';
import type { IWorkspacesRepository } from '../types/workspaces-repository.js';
import type { IColdWorkspacesStorage } from '../types/cold-workspaces-storage.js';
import { WorkspaceCreateSchema, WorkspaceUpdateSchema } from '../types/workspace.js';
import { workspaceSelectSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { WorkspacesDomainError } from '../errors/base.js';

type WorkspacesRow = z.infer<typeof workspaceSelectSchema>;

function rowToWorkspace(row: WorkspacesRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    projectPath: row.projectPath,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export class WorkspacesRepository implements IWorkspacesRepository {
  constructor(private readonly cold: IColdWorkspacesStorage) {}

  async findAll(): Promise<Workspace[]> {
    const rows = await this.cold.findAll();
    return rows.map((row) => {
      try {
        return rowToWorkspace(workspaceSelectSchema.parse(row));
      } catch (err) {
        if (err instanceof WorkspacesDomainError) throw err;
        throw new ValidationError('Invalid workspace row from storage', {
          rowId: (row as { id?: unknown }).id,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async findById(id: string): Promise<Workspace | null> {
    const row = await this.cold.findById(id);
    if (!row) return null;
    let validated: WorkspacesRow;
    try {
      validated = workspaceSelectSchema.parse(row);
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new ValidationError('Invalid workspace row from storage', {
        rowId: id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToWorkspace(validated);
  }

  async create(data: WorkspaceCreateInput): Promise<Workspace> {
    const parsed = WorkspaceCreateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid workspace: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, data },
      );
    }

    const now = new Date().toISOString();
    const row: WorkspacesRow = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      projectPath: parsed.data.projectPath,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await this.cold.insert(row);
    let validated: WorkspacesRow;
    try {
      validated = workspaceSelectSchema.parse(inserted);
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new ValidationError('Invalid workspace row after insert', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToWorkspace(validated);
  }

  async update(id: string, data: WorkspaceUpdateInput): Promise<Workspace> {
    const parsed = WorkspaceUpdateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid workspace update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id, data },
      );
    }

    const now = new Date().toISOString();
    const patch: Partial<WorkspacesRow> = {
      ...parsed.data,
      updatedAt: now,
    };

    const updated = await this.cold.update(id, patch);
    let validated: WorkspacesRow;
    try {
      validated = workspaceSelectSchema.parse(updated);
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new ValidationError('Invalid workspace row after update', {
        id,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return rowToWorkspace(validated);
  }

  async remove(id: string): Promise<void> {
    await this.cold.delete(id);
  }
}
