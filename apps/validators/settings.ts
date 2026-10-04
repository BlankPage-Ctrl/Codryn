import { z } from 'zod';
import {
  SettingsQuerySchema,
  assertMaxDepth,
} from '../../src/settings/query/settings-query.schema.js';

export const SettingKeyParamsSchema = z.object({
  key: z.string().min(1),
});

export const SettingValueSchema = z
  .object({
    value: z.string().max(5000),
  })
  .strict();

export function validateSettingKey(params: unknown) {
  return SettingKeyParamsSchema.parse(params);
}

export function validateSettingValue(body: unknown) {
  return SettingValueSchema.parse(body);
}

export function validateSettingsQuery(body: unknown) {
  const parsed = SettingsQuerySchema.parse(body ?? {});
  assertMaxDepth(parsed.where);
  return parsed;
}
