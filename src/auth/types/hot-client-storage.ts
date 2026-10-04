import type { ClientRow } from '../schemas/client.js';

export interface IHotClientStorage {
  get(clientId: string): Promise<ClientRow | null>;
  set(clientId: string, row: ClientRow): Promise<void>;
  delete(clientId: string): Promise<void>;
  has(clientId: string): Promise<boolean>;
}
