import { NotFoundError } from '../shared/errors.js';
import { loadPluginRegistry, setPluginEnabled as persistPluginEnabled } from '../plugins/index.js';
import type { PluginState } from '../plugins/index.js';
import {
  resolvePluginProjectPath,
  assertPluginsEnabled,
  type PluginActionCtx,
} from './list.plugin.js';
import { getPlugin } from './get.plugin.js';

export interface SetPluginEnabledParams {
  workspaceId: string;
  id: string;
  enabled: boolean;
}

export interface SetPluginEnabledResult {
  workspaceId: string;
  plugin: PluginState;
}

export async function setPluginEnabled(
  ctx: PluginActionCtx,
  params: SetPluginEnabledParams,
): Promise<SetPluginEnabledResult> {
  assertPluginsEnabled(ctx);
  const projectPath = await resolvePluginProjectPath(ctx, params.workspaceId);
  const entries = await loadPluginRegistry(projectPath);
  if (!entries.some((e) => e.entry.id === params.id)) {
    throw new NotFoundError(`Plugin ${params.id} not found in the plugin registry`);
  }
  await persistPluginEnabled(ctx.settingsService, params.workspaceId, params.id, params.enabled);
  return getPlugin(ctx, { workspaceId: params.workspaceId, id: params.id });
}
