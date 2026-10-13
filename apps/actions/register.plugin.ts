import { registerPlugin as persistPluginPlugin } from '../plugins/external-registry.js';
import { assertPluginsEnabled, type PluginActionCtx } from './list.plugin.js';

export interface RegisterPluginParams {
  pluginId: string;
  pluginDir?: string;
}

export interface RegisterPluginResult {
  pluginId: string;
  enabled: true;
}

export async function registerPlugin(
  ctx: PluginActionCtx,
  params: RegisterPluginParams,
): Promise<RegisterPluginResult> {
  assertPluginsEnabled(ctx);
  await persistPluginPlugin(params.pluginId, params.pluginDir, ctx.logger as never);
  return { pluginId: params.pluginId, enabled: true };
}
