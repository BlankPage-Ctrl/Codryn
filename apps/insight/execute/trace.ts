import { getInsightManager } from '../manager.js';
import { isInsightEnabled } from './settings.js';
import type { InsightSettingsPort, InsightTraceOptions, InsightTraceReport } from '../types.js';
import { InsightNotRunningError } from './search.js';

export async function insightTrace(
  deps: { workspaceId: string; settings: InsightSettingsPort },
  opts: InsightTraceOptions,
): Promise<InsightTraceReport> {
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
  return client.trace(opts);
}
