import { workspaceKey } from '../../shared/workspace-settings.js';
import { INSIGHT_SETTING_SUFFIX } from '../constants.js';
import type { InsightSettingsPort } from '../types.js';

export async function isInsightEnabled(
  settings: InsightSettingsPort,
  workspaceId: string,
): Promise<boolean> {
  const key = workspaceKey(workspaceId, INSIGHT_SETTING_SUFFIX);
  const raw = await settings.getValue(key);
  // default false when key absent or empty (mirrors WORKSPACE_SETTING_TEMPLATES defaultValue)
  if (raw === null || raw === '') return false;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'off' ||
    normalized === 'disabled'
  )
    return false;
  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'on' ||
    normalized === 'enabled'
  )
    return true;
  // any other non-empty string defaults to disabled
  return false;
}

export function insightWorkspaceKey(workspaceId: string): string {
  return workspaceKey(workspaceId, INSIGHT_SETTING_SUFFIX);
}
