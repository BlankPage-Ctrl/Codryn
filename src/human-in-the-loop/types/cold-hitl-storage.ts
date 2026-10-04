import type { HitlRequestRow, NewHitlRequestRow, HitlRequestPatchRow } from '../schemas/index.js';

export interface IColdHitlStorage {
  findById(id: string): Promise<HitlRequestRow | null>;
  findManyByStatus(status: string): Promise<HitlRequestRow[]>;
  insert(row: NewHitlRequestRow): Promise<void>;
  update(id: string, patch: HitlRequestPatchRow): Promise<HitlRequestRow>;
}
