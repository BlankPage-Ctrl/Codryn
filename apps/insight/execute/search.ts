import { getInsightManager } from '../manager.js';
import { InsightBinaryError } from './errors.js';
import { isInsightEnabled } from './settings.js';
import type { InsightSearchOptions, InsightSearchResult, InsightSettingsPort } from '../types.js';

export class InsightNotRunningError extends InsightBinaryError {
  constructor(workspaceId: string) {
    super(
      `insight not running for workspace ${workspaceId} — call POST /workspaces/${workspaceId}/insight/ensure after workspace select to warmup standby daemon`,
    );
    this.name = 'InsightNotRunningError';
    (this as unknown as Record<string, unknown>).code = 'INSIGHT_NOT_RUNNING';
    (this as unknown as Record<string, unknown>).status = 503;
  }
}

export async function insightSearch(
  deps: { workspaceId: string; settings: InsightSettingsPort },
  opts: InsightSearchOptions,
): Promise<InsightSearchResult> {
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
  return client.search(opts);
}
