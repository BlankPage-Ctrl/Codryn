import type { Client, ClientCreateInput, ClientUpdateInput } from './client.js';
import type { VerifySignatureInput, VerifySignatureResult } from './hmac-types.js';

export interface IClientService {
  findAll(): Promise<Client[]>;
  findOne(id: string): Promise<Client>;
  findByClientId(clientId: string): Promise<Client>;
  create(data: ClientCreateInput): Promise<Client>;
  update(id: string, data: ClientUpdateInput): Promise<Client>;
  remove(id: string): Promise<void>;
  rotateSecretKey(id: string): Promise<Client>;
  verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult>;
}
