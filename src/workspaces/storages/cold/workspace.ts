import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdWorkspacesStorage } from '../../types/cold-workspaces-storage.js';
import { workspaces, type WorkspacesRow } from '../../schemas/index.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { WorkspaceNotFoundError } from '../../errors/not-found.js';
import { WorkspacesDomainError } from '../../errors/base.js';

export class ColdWorkspacesStorage implements IColdWorkspacesStorage {
  constructor(protected readonly db: Database) {}

  async findAll(): Promise<WorkspacesRow[]> {
    try {
      return await this.db.select().from(workspaces);
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new StorageReadError('workspaces', err);
    }
  }

  async findById(id: string): Promise<WorkspacesRow | null> {
    try {
      const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new StorageReadError('workspaces', err, { id });
    }
  }

  async insert(row: WorkspacesRow): Promise<WorkspacesRow> {
    try {
      const rows = await this.db.insert(workspaces).values(row).returning();
      return rows[0];
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new StorageWriteError('workspaces', err, { row });
    }
  }

  async update(id: string, patch: Partial<WorkspacesRow>): Promise<WorkspacesRow> {
    try {
      const rows = await this.db
        .update(workspaces)
        .set(patch)
        .where(eq(workspaces.id, id))
        .returning();
      if (!rows[0]) throw new WorkspaceNotFoundError(id);
      return rows[0];
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new StorageWriteError('workspaces', err, { id, patch });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(workspaces).where(eq(workspaces.id, id));
    } catch (err) {
      if (err instanceof WorkspacesDomainError) throw err;
      throw new StorageWriteError('workspaces', err, { id });
    }
  }
}
