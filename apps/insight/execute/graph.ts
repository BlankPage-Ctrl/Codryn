import { getInsightManager } from '../manager.js';
import { isInsightEnabled } from './settings.js';
import type { InsightGraph, InsightGraphOptions, InsightSettingsPort } from '../types.js';
import { InsightNotRunningError } from './search.js';

export async function insightGraph(
  deps: { workspaceId: string; settings: InsightSettingsPort },
  opts: InsightGraphOptions,
): Promise<InsightGraph> {
  const enabled = await isInsightEnabled(deps.settings, deps.workspaceId);
  if (!enabled) {
    getInsightManager()
      .stop(deps.workspaceId)
      .catch(() => {});
    const { InsightDisabledError } = await import('./errors.js');
    throw new InsightDisabledError(deps.workspaceId);
  }
  const manager = getInsightManager();
  const client = manager.get(deps.workspaceId);
  if (!client) throw new InsightNotRunningError(deps.workspaceId);
  if (client.terminalError) throw client.terminalError;
  return client.graph(opts);
}
