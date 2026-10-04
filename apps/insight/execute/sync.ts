import { getInsightManager } from '../manager.js';
import { isInsightEnabled } from './settings.js';
import type {
  InsightIndexOptions,
  InsightSettingsPort,
  InsightStatusResult,
  InsightSyncResult,
} from '../types.js';
import { InsightNotRunningError } from './search.js';

async function requireClient(workspaceId: string, settings: InsightSettingsPort) {
  const enabled = await isInsightEnabled(settings, workspaceId);
  if (!enabled) {
    getInsightManager()
      .stop(workspaceId)
      .catch(() => {});
    const { InsightDisabledError } = await import('./errors.js');
    throw new InsightDisabledError(workspaceId);
  }
  const manager = getInsightManager();
  const client = manager.get(workspaceId);
  if (!client) throw new InsightNotRunningError(workspaceId);
  if (client.terminalError) throw client.terminalError;
  return client;
}

export async function insightSync(deps: {
  workspaceId: string;
  settings: InsightSettingsPort;
}): Promise<InsightSyncResult> {
  const client = await requireClient(deps.workspaceId, deps.settings);
  return client.sync();
}

export async function insightIndex(
  deps: { workspaceId: string; settings: InsightSettingsPort },
  opts: InsightIndexOptions = {},
): Promise<InsightSyncResult> {
  const client = await requireClient(deps.workspaceId, deps.settings);
  return client.index(opts);
}

export async function insightIndexStatus(deps: {
  workspaceId: string;
  settings: InsightSettingsPort;
}): Promise<InsightStatusResult> {
  const client = await requireClient(deps.workspaceId, deps.settings);
  return client.status();
}

export async function insightPing(deps: {
  workspaceId: string;
  settings: InsightSettingsPort;
}): Promise<{ ok: true }> {
  const enabled = await isInsightEnabled(deps.settings, deps.workspaceId);
  if (!enabled) {
    const { InsightDisabledError } = await import('./errors.js');
    throw new InsightDisabledError(deps.workspaceId);
  }
  const manager = getInsightManager();
  const client = manager.get(deps.workspaceId);
  if (!client) throw new InsightNotRunningError(deps.workspaceId);
  return client.ping();
}
