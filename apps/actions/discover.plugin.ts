import { discoverPlugins as discoverPluginsFs } from '../plugins/external-registry.js';
import type { DiscoveredPlugin } from '../plugins/external-registry.js';
import { assertPluginsEnabled, type PluginActionCtx } from './list.plugin.js';

export interface DiscoverPluginsResult {
  plugins: DiscoveredPlugin[];
}

export async function discoverPlugins(ctx: PluginActionCtx): Promise<DiscoverPluginsResult> {
  assertPluginsEnabled(ctx);
  const plugins = await discoverPluginsFs(ctx.logger as never);
  return { plugins };
}
