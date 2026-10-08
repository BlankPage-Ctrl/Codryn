import type { Container } from '../bootstrap.js';
import { AppError, NotFoundError } from '../shared/errors.js';
import { loadPluginStates } from '../plugins/index.js';
import type { PluginState } from '../plugins/index.js';

export interface ListPluginsParams {
  workspaceId: string;
}

export interface ListPluginsResult {
  workspaceId: string;
  plugins: PluginState[];
}

export type PluginActionCtx = Pick<
  Container,
  'workspacesService' | 'settingsService' | 'logger' | 'pluginsEnabled' | 'pluginLimits'
>;

export function assertPluginsEnabled(ctx: PluginActionCtx): void {
  if (!ctx.pluginsEnabled) {
    throw new AppError(403, 'Plugin system is disabled by server configuration.', 'FORBIDDEN');
  }
}
export async function resolvePluginProjectPath(
  ctx: PluginActionCtx,
  workspaceId: string,
): Promise<string> {
  const ws = await ctx.workspacesService.findOne(workspaceId);
  if (!ws) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  return ws.projectPath;
}

export async function listPlugins(
  ctx: PluginActionCtx,
  params: ListPluginsParams,
): Promise<ListPluginsResult> {
  const projectPath = await resolvePluginProjectPath(ctx, params.workspaceId);
  if (!ctx.pluginsEnabled) return { workspaceId: params.workspaceId, plugins: [] };
  const { states } = await loadPluginStates(
    projectPath,
    params.workspaceId,
    ctx.settingsService,
    ctx.logger,
    ctx.pluginLimits,
  );
  return { workspaceId: params.workspaceId, plugins: states };
}
