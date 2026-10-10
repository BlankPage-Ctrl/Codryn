import { unregisterPlugin as persistUnregisterPlugin } from '../plugins/external-registry.js';
import { assertPluginsEnabled, type PluginActionCtx } from './list.plugin.js';

export interface UnregisterPluginParams {
  pluginId: string;
}

export interface UnregisterPluginResult {
  pluginId: string;
  unregistered: true;
}

export async function unregisterPlugin(
  ctx: PluginActionCtx,
  params: UnregisterPluginParams,
): Promise<UnregisterPluginResult> {
  assertPluginsEnabled(ctx);
  await persistUnregisterPlugin(params.pluginId, ctx.logger as never);
  return { pluginId: params.pluginId, unregistered: true };
}
