import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/database.manager.js';
import type { IColdClientStorage } from '../../types/cold-client-storage.js';
import { client, type ClientRow } from '../../schemas/client.js';
import { AuthDomainError } from '../../errors/base.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { ClientNotFoundError } from '../../errors/not-found.js';

export class ColdClientStorage implements IColdClientStorage {
  constructor(protected readonly db: Database) {}

  async findAll(): Promise<ClientRow[]> {
    try {
      return await this.db.select().from(client);
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      throw new StorageReadError('client', err);
    }
  }

  async findById(id: string): Promise<ClientRow | null> {
    try {
      const rows = await this.db.select().from(client).where(eq(client.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      throw new StorageReadError('client', err, { id });
    }
  }

  async findByClientId(clientId: string): Promise<ClientRow | null> {
    try {
      const rows = await this.db
        .select()
        .from(client)
        .where(eq(client.clientId, clientId))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      throw new StorageReadError('client', err, { clientId });
    }
  }

  async insert(row: ClientRow): Promise<ClientRow> {
    try {
      const rows = await this.db.insert(client).values(row).returning();
      if (!rows[0]) throw new StorageWriteError('client', 'empty returning', { id: row.id });
      return rows[0];
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      throw new StorageWriteError('client', err, { id: row.id });
    }
  }

  async update(id: string, patch: Partial<ClientRow>): Promise<ClientRow> {
    try {
      const rows = await this.db.update(client).set(patch).where(eq(client.id, id)).returning();
      if (!rows[0]) throw new ClientNotFoundError(id);
      return rows[0];
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      // NOTE: patch is deliberately excluded from details, rotateSecretKey
      // passes the new secretKey through here and secrets must never land in logs.
      throw new StorageWriteError('client', err, { id });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(client).where(eq(client.id, id));
    } catch (err) {
      if (err instanceof AuthDomainError) throw err;
      throw new StorageWriteError('client', err, { id });
    }
  }
}
