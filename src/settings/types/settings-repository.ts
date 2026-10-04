import type { Setting } from './setting.js';
import type { SettingsQuery } from '../query/settings-query.types.js';

export interface ISettingsRepository {
  findOneWhere(where: { key: string }): Promise<Setting | null>;
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<Setting>;
  findMany(query: SettingsQuery): Promise<Setting[]>;
  count(query: SettingsQuery): Promise<number>;
  query(query: SettingsQuery): Promise<Setting[]>;
}
