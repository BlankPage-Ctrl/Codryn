import type { SettingsRow } from '../schemas/index.js';
import type { SettingsQuery } from '../query/settings-query.types.js';

export interface IColdSettingsStorage {
  findOneWhere(where: { key: string }): Promise<SettingsRow | null>;
  upsert(key: string, value: string, now: string): Promise<SettingsRow>;
  findMany(query: SettingsQuery): Promise<SettingsRow[]>;
  count(query: SettingsQuery): Promise<number>;
}
