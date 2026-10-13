import { NotFoundError } from '../shared/errors.js';
import { loadPluginStates } from '../plugins/index.js';
import type { PluginState } from '../plugins/index.js';
import {
  assertPluginsEnabled,
  resolvePluginProjectPath,
  type PluginActionCtx,
} from './list.plugin.js';

export interface GetPluginParams {
  workspaceId: string;
  id: string;
}

export interface GetPluginResult {
  workspaceId: string;
  plugin: PluginState;
}

export async function getPlugin(
  ctx: PluginActionCtx,
  params: GetPluginParams,
): Promise<GetPluginResult> {
  assertPluginsEnabled(ctx);
  const projectPath = await resolvePluginProjectPath(ctx, params.workspaceId);
  const { states } = await loadPluginStates(
    projectPath,
    params.workspaceId,
    ctx.settingsService,
    ctx.logger,
    ctx.pluginLimits,
  );
  const plugin = states.find((s) => s.id === params.id);
  if (!plugin) throw new NotFoundError(`Plugin ${params.id} not found`);
  return { workspaceId: params.workspaceId, plugin };
}
