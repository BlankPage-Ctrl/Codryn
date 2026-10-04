import type { Setting } from '../types/setting.js';
import type { ISettingsRepository } from '../types/settings-repository.js';
import type { IColdSettingsStorage } from '../types/cold-settings-storage.js';
import { SettingCreateSchema } from '../types/setting.js';
import { settingsSelectSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { SettingsDomainError } from '../errors/base.js';
import type { SettingsQuery } from '../query/settings-query.types.js';
import { assertMaxDepth, SettingsQuerySchema } from '../query/settings-query.schema.js';

type SettingsRow = z.infer<typeof settingsSelectSchema>;

function parseSettingsRow(row: unknown, context?: Record<string, unknown>): SettingsRow {
  try {
    return settingsSelectSchema.parse(row);
  } catch (err) {
    if (err instanceof SettingsDomainError) throw err;
    throw new ValidationError('Invalid settings row from storage', {
      ...context,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

function rowToSetting(row: SettingsRow): Setting {
  return {
    key: row.key,
    value: row.value,
    created_at: new Date(row.createdAt),
    updated_at: new Date(row.updatedAt),
  };
}

export class SettingsRepository implements ISettingsRepository {
  constructor(private readonly cold: IColdSettingsStorage) {}

  async findOneWhere(where: { key: string }): Promise<Setting | null> {
    const row = await this.cold.findOneWhere(where);
    if (!row) return null;
    const validated = parseSettingsRow(row, { key: where.key });
    return rowToSetting(validated);
  }

  async getValue(key: string): Promise<string | null> {
    const setting = await this.findOneWhere({ key });
    return setting?.value ?? null;
  }

  async setValue(key: string, value: string): Promise<Setting> {
    const parsed = SettingCreateSchema.safeParse({ key, value });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid setting: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, key },
      );
    }

    const now = new Date().toISOString();
    const row = await this.cold.upsert(parsed.data.key, parsed.data.value, now);
    const validated = parseSettingsRow(row, { key: parsed.data.key });
    return rowToSetting(validated);
  }

  async findMany(query: SettingsQuery): Promise<Setting[]> {
    const parsed = SettingsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid settings query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        {
          issues: parsed.error.issues,
        },
      );
    }
    try {
      assertMaxDepth(parsed.data.where);
    } catch (e) {
      throw new ValidationError((e as Error).message, { where: parsed.data.where });
    }
    const rows = await this.cold.findMany(parsed.data as SettingsQuery);
    return rows.map((row) => {
      const validated = parseSettingsRow(row, { query });
      return rowToSetting(validated);
    });
  }

  async count(query: SettingsQuery): Promise<number> {
    const parsed = SettingsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid settings query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        {
          issues: parsed.error.issues,
        },
      );
    }
    try {
      assertMaxDepth(parsed.data.where);
    } catch (e) {
      throw new ValidationError((e as Error).message, { where: parsed.data.where });
    }
    return this.cold.count(parsed.data as SettingsQuery);
  }

  async query(query: SettingsQuery): Promise<Setting[]> {
    return this.findMany(query);
  }
}
