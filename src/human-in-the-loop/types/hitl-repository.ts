import type { HITLStatus, HitlRequest } from './common.js';

export interface IHitlRepository {
  findById(id: string): Promise<HitlRequest | null>;
  listByStatus(status: HITLStatus): Promise<HitlRequest[]>;
  insert(request: HitlRequest): Promise<void>;
  update(id: string, patch: Partial<HitlRequest>): Promise<HitlRequest>;
}
