import type { ISettingsService } from '../types/settings-service.js';
import type { ISettingsRepository } from '../types/settings-repository.js';
import { SettingCreateSchema } from '../types/setting.js';
import { ValidationError } from '../errors/validation.js';
import type { Setting } from '../types/setting.js';
import type { SettingsQuery } from '../query/settings-query.types.js';
import { assertMaxDepth, SettingsQuerySchema } from '../query/settings-query.schema.js';

export class SettingsService implements ISettingsService {
  constructor(private readonly repo: ISettingsRepository) {}

  async getValue(key: string): Promise<string | null> {
    return this.repo.getValue(key);
  }

  async setValue(key: string, value: string): Promise<void> {
    const parsed = SettingCreateSchema.safeParse({ key, value });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid setting: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, key },
      );
    }
    await this.repo.setValue(parsed.data.key, parsed.data.value);
  }

  private parseQuery(query: SettingsQuery): SettingsQuery {
    const parsed = SettingsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid settings query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    try {
      assertMaxDepth(parsed.data.where);
    } catch (e) {
      throw new ValidationError((e as Error).message, { where: parsed.data.where });
    }
    return parsed.data as SettingsQuery;
  }

  async findMany(query: SettingsQuery): Promise<Setting[]> {
    const q = this.parseQuery(query);
    return this.repo.findMany(q);
  }

  async query(query: SettingsQuery): Promise<Setting[]> {
    return this.findMany(query);
  }

  async count(query: SettingsQuery): Promise<number> {
    const q = this.parseQuery(query);
    return this.repo.count(q);
  }
}
