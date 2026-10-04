import type { Client, ClientCreateInput, ClientUpdateInput } from './client.js';

export interface IClientRepository {
  findAll(): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  findByClientId(clientId: string): Promise<Client | null>;
  create(data: ClientCreateInput): Promise<Client>;
  update(id: string, data: ClientUpdateInput): Promise<Client>;
  remove(id: string): Promise<void>;
  rotateSecretKey(id: string): Promise<Client>;
}
