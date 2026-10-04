import type { Container } from '../bootstrap.js';
import { getInsightManager } from '../insight/manager.js';
import type { InsightEnsureResult } from '../insight/types.js';

export async function ensureInsight(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string },
): Promise<InsightEnsureResult> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  if (!ws) {
    const err = new Error(`Workspace ${params.workspaceId} not found`);
    (err as unknown as Record<string, unknown>).status = 404;
    (err as unknown as Record<string, unknown>).code = 'NOT_FOUND';
    throw err;
  }

  const manager = getInsightManager(ctx.logger);
  const res = await manager.ensure({
    workspaceId: params.workspaceId,
    projectPath: ws.projectPath,
    settings: ctx.settingsService,
    logger: ctx.logger,
  });
  return res;
}

export async function getInsightStatus(
  ctx: Pick<Container, 'workspacesService' | 'settingsService' | 'logger'>,
  params: { workspaceId: string },
): Promise<InsightEnsureResult> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  if (!ws) {
    const err = new Error(`Workspace ${params.workspaceId} not found`);
    (err as unknown as Record<string, unknown>).status = 404;
    (err as unknown as Record<string, unknown>).code = 'NOT_FOUND';
    throw err;
  }
  const { isInsightEnabled } = await import('../insight/execute/settings.js');
  const enabled = await isInsightEnabled(ctx.settingsService, params.workspaceId);
  const manager = getInsightManager(ctx.logger);
  const st = manager.status(params.workspaceId);
  // if disabled, ensure daemon is stopped
  if (!enabled && st.running) {
    await manager.stop(params.workspaceId);
    return {
      workspaceId: params.workspaceId,
      enabled: false,
      running: false,
      projectPath: ws.projectPath,
    };
  }
  return {
    workspaceId: params.workspaceId,
    enabled,
    running: st.running,
    projectPath: ws.projectPath,
  };
}

export async function stopInsight(
  ctx: Pick<Container, 'logger'>,
  params: { workspaceId: string },
): Promise<{ workspaceId: string; stopped: boolean }> {
  const manager = getInsightManager(ctx.logger);
  const stopped = await manager.stop(params.workspaceId);
  return { workspaceId: params.workspaceId, stopped };
}
