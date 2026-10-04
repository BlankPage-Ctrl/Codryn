import type { Container } from '../bootstrap.js';
import { insightSearch } from '../insight/execute/search.js';
import type { InsightSearchOptions, InsightSearchResult } from '../insight/types.js';

export async function searchInsight(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string } & InsightSearchOptions,
): Promise<InsightSearchResult> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  if (!ws) {
    const err = new Error(`Workspace ${params.workspaceId} not found`);
    (err as unknown as Record<string, unknown>).status = 404;
    (err as unknown as Record<string, unknown>).code = 'NOT_FOUND';
    throw err;
  }
  const { workspaceId, ...opts } = params;
  return insightSearch({ workspaceId, settings: ctx.settingsService }, opts);
}
