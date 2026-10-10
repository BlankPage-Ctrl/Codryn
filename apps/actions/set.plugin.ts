import { NotFoundError } from '../shared/errors.js';
import { loadRegisteredPlugins, setPluginEnabledSetting } from '../plugins/index.js';
import type { PluginState } from '../plugins/index.js';
import {
  assertPluginsEnabled,
  resolvePluginProjectPath,
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
  await resolvePluginProjectPath(ctx, params.workspaceId);
  const entries = await loadRegisteredPlugins(ctx.logger as never);
  if (!entries.some((e) => e.entry.id === params.id)) {
    throw new NotFoundError(`Plugin ${params.id} not found in the plugin registry`);
  }
  await setPluginEnabledSetting(
    ctx.settingsService,
    params.workspaceId,
    params.id,
    params.enabled,
  );
  return getPlugin(ctx, { workspaceId: params.workspaceId, id: params.id });
}
