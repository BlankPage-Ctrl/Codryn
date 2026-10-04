import type { Container } from '../bootstrap.js';
import { insightIndex, insightIndexStatus, insightSync } from '../insight/execute/sync.js';
import type {
  InsightIndexOptions,
  InsightStatusResult,
  InsightSyncResult,
} from '../insight/types.js';

function requireWorkspace(ctx: Pick<Container, 'workspacesService'>, workspaceId: string) {
  return ctx.workspacesService.findOne(workspaceId).then((ws) => {
    if (!ws) {
      const err = new Error(`Workspace ${workspaceId} not found`);
      (err as unknown as Record<string, unknown>).status = 404;
      (err as unknown as Record<string, unknown>).code = 'NOT_FOUND';
      throw err;
    }
    return ws;
  });
}

export async function syncInsight(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string },
): Promise<InsightSyncResult> {
  await requireWorkspace(ctx, params.workspaceId);
  return insightSync({ workspaceId: params.workspaceId, settings: ctx.settingsService });
}

export async function indexInsight(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string } & InsightIndexOptions,
): Promise<InsightSyncResult> {
  await requireWorkspace(ctx, params.workspaceId);
  return insightIndex(
    { workspaceId: params.workspaceId, settings: ctx.settingsService },
    { force: params.force },
  );
}

export async function indexStatusInsight(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string },
): Promise<InsightStatusResult> {
  await requireWorkspace(ctx, params.workspaceId);
  return insightIndexStatus({ workspaceId: params.workspaceId, settings: ctx.settingsService });
}
