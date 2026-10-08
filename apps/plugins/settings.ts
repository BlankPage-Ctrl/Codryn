import { workspaceKey } from '../shared/workspace-settings.js';

export const PLUGIN_SETTING_PREFIX = 'plugin:';

export interface PluginSettingsPort {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
}

/** Settings KV key for one plugin's on/off toggle. Default ON when absent. */
export function pluginKey(workspaceId: string, pluginId: string): string {
  return workspaceKey(workspaceId, `${PLUGIN_SETTING_PREFIX}${pluginId}`);
}

function parseEnabled(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return true;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off' || v === 'disabled') return false;
  return true;
}

export async function isPluginEnabled(
  settings: Pick<PluginSettingsPort, 'getValue'>,
  workspaceId: string,
  pluginId: string,
): Promise<boolean> {
  const raw = await settings.getValue(pluginKey(workspaceId, pluginId));
  return parseEnabled(raw);
}

export async function setPluginEnabled(
  settings: Pick<PluginSettingsPort, 'setValue'>,
  workspaceId: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await settings.setValue(pluginKey(workspaceId, pluginId), enabled ? 'true' : 'false');
}
