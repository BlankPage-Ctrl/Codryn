import type { SettingsQuery } from '../query/settings-query.types.js';
import type { Setting } from './setting.js';

export interface ISettingsService {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
  findMany(query: SettingsQuery): Promise<Setting[]>;
  query(query: SettingsQuery): Promise<Setting[]>;
  count(query: SettingsQuery): Promise<number>;
}
