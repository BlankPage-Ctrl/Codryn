import crypto from 'crypto';
import type { Client, ClientCreateInput, ClientUpdateInput } from '../types/client.js';
import type { IClientRepository } from '../types/client-repository.js';
import type { IColdClientStorage } from '../types/cold-client-storage.js';
import type { IHotClientStorage } from '../types/hot-client-storage.js';
import { ClientCreateSchema, ClientUpdateSchema } from '../types/client.js';
import { clientSelectSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { AuthDomainError } from '../errors/base.js';

type ClientRow = z.infer<typeof clientSelectSchema>;

// NOTE: error details in this domain must only ever carry identifiers
// (id / clientId) - never the row itself, which contains the secretKey.

function parseClientRow(row: unknown, context?: Record<string, unknown>): ClientRow {
  try {
    return clientSelectSchema.parse(row);
  } catch (err) {
    if (err instanceof AuthDomainError) throw err;
    throw new ValidationError('Invalid client row from storage', {
      ...context,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

function rowToClient(row: ClientRow): Client {
  return {
    id: row.id,
    clientId: row.clientId,
    secretKey: row.secretKey,
    name: row.name,
    description: row.description ?? null,
    isActive: row.isActive,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export class ClientRepository implements IClientRepository {
  constructor(
    private readonly cold: IColdClientStorage,
    private readonly hot: IHotClientStorage,
  ) {}

  async findAll(): Promise<Client[]> {
    const rows = await this.cold.findAll();
    return rows.map((row) =>
      rowToClient(parseClientRow(row, { id: (row as { id?: unknown }).id })),
    );
  }

  async findById(id: string): Promise<Client | null> {
    const row = await this.cold.findById(id);
    if (!row) return null;
    return rowToClient(parseClientRow(row, { id }));
  }

  async findByClientId(clientId: string): Promise<Client | null> {
    // NOTE (why self healing instead of throw): the hot cache is volatile,
    // a corrupt/stale entry must never fail a read when cold still holds good
    // data. So an unparsable cached blob is evicted and the read falls through
    // to cold (which re populates the cache), instead of throwing ValidationError.
    const cached = await this.hot.get(clientId);
    if (cached) {
      try {
        return rowToClient(clientSelectSchema.parse(cached));
      } catch {
        await this.hot.delete(clientId);
      }
    }

    const row = await this.cold.findByClientId(clientId);
    if (!row) return null;

    await this.hot.set(clientId, row);
    return rowToClient(parseClientRow(row, { clientId }));
  }

  async create(data: ClientCreateInput): Promise<Client> {
    const parsed = ClientCreateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid client: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const clientId = `cli_${id.replace(/-/g, '').slice(0, 24)}`;
    const secretKey = crypto.randomBytes(32).toString('hex');

    const row: ClientRow = {
      id,
      clientId,
      secretKey,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await this.cold.insert(row);
    const validated = parseClientRow(inserted, { id, clientId });
    await this.hot.set(validated.clientId, validated);
    return rowToClient(validated);
  }

  async update(id: string, data: ClientUpdateInput): Promise<Client> {
    const parsed = ClientUpdateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid client update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id },
      );
    }

    const now = new Date().toISOString();
    const patch: Partial<ClientRow> = {
      ...parsed.data,
      updatedAt: now,
    };

    const updated = await this.cold.update(id, patch);
    const validated = parseClientRow(updated, { id });

    await this.hot.delete(validated.clientId);
    await this.hot.set(validated.clientId, validated);

    return rowToClient(validated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.cold.findById(id);
    if (existing) {
      await this.hot.delete(existing.clientId);
    }
    await this.cold.delete(id);
  }

  async rotateSecretKey(id: string): Promise<Client> {
    const now = new Date().toISOString();
    const newSecretKey = crypto.randomBytes(32).toString('hex');

    const updated = await this.cold.update(id, {
      secretKey: newSecretKey,
      updatedAt: now,
    });
    const validated = parseClientRow(updated, { id });

    await this.hot.delete(validated.clientId);
    await this.hot.set(validated.clientId, validated);

    return rowToClient(validated);
  }
}
