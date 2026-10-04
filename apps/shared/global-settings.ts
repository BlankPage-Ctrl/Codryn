import type { Container } from '../bootstrap.js';

export const GLOBAL_SETTINGS = {
  DEFAULT_PROVIDER_ID: {
    key: 'defaultProviderId',
    defaultValue: null as string | null, // null = skip init (optional key)
    description: 'Default provider id (refs provider.id)',
  },
  DEFAULT_MODEL_ID: {
    key: 'defaultModelId',
    defaultValue: null as string | null,
    description: 'Default model id (refs model.id)',
  },
} as const;

export type GlobalSettingKey = (typeof GLOBAL_SETTINGS)[keyof typeof GLOBAL_SETTINGS]['key'];

// Helper: list all keys for wildcard/query usage etc.
export const GLOBAL_SETTING_KEYS = Object.values(GLOBAL_SETTINGS).map((v) => v.key) as string[];

/**
 * Ensure all global settings exist. Idempotent.
 * - If the key already exists, skip (not overwrite).
 * - If defaultValue === null, skip (key optional - let be missing).
 * - If defaultValue string, insert via setValue (allow empty string "").
 */
export async function ensureGlobalSettings(
  ctx: Pick<Container, 'settingsService' | 'logger'>,
): Promise<void> {
  for (const entry of Object.values(GLOBAL_SETTINGS)) {
    if (entry.defaultValue === null) continue;
    try {
      const existing = await ctx.settingsService.getValue(entry.key);
      if (existing !== null) continue;
      await ctx.settingsService.setValue(entry.key, entry.defaultValue);
      ctx.logger?.info?.({ key: entry.key }, `global-settings: initialized ${entry.key}`);
    } catch (err) {
      ctx.logger?.warn?.({ err, key: entry.key }, `global-settings: failed to ensure ${entry.key}`);
    }
  }
}

export async function resetGlobalSetting(
  ctx: Pick<Container, 'settingsService'>,
  key: GlobalSettingKey,
): Promise<void> {
  await ctx.settingsService.setValue(key, '');
}

// Convenience wrappers
export async function getDefaultProviderGlobal(
  ctx: Pick<Container, 'settingsService'>,
): Promise<{ providerId: string | null; modelId: string | null }> {
  const [providerId, modelId] = await Promise.all([
    ctx.settingsService.getValue(GLOBAL_SETTINGS.DEFAULT_PROVIDER_ID.key),
    ctx.settingsService.getValue(GLOBAL_SETTINGS.DEFAULT_MODEL_ID.key),
  ]);
  // empty string "" will be treated as null
  return {
    providerId: providerId && providerId !== '' ? providerId : null,
    modelId: modelId && modelId !== '' ? modelId : null,
  };
}

export async function setDefaultProviderGlobal(
  ctx: Pick<Container, 'settingsService'>,
  providerId: string,
  modelId: string,
): Promise<void> {
  await ctx.settingsService.setValue(GLOBAL_SETTINGS.DEFAULT_PROVIDER_ID.key, providerId);
  await ctx.settingsService.setValue(GLOBAL_SETTINGS.DEFAULT_MODEL_ID.key, modelId);
}
