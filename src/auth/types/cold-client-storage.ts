import type { ClientRow } from '../schemas/client.js';

export interface IColdClientStorage {
  findAll(): Promise<ClientRow[]>;
  findById(id: string): Promise<ClientRow | null>;
  findByClientId(clientId: string): Promise<ClientRow | null>;
  insert(row: ClientRow): Promise<ClientRow>;
  update(id: string, patch: Partial<ClientRow>): Promise<ClientRow>;
  delete(id: string): Promise<void>;
}
