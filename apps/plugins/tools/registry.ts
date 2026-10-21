import type { PluginDescriptor, PluginHost } from '../host.js';
import {
  PluginToolMethods,
  type PluginToolsCallParams,
  type PluginToolsCallResult,
} from './protocol.js';

const NAMESPACED_TOOL = /^([a-z0-9-]+)__([a-z0-9_-]+)$/i;

/** The plugin that declared this tool, if any. */
export function findPluginForTool(host: PluginHost, toolName: string): PluginDescriptor | null {
  for (const plugin of host.getAllPlugins()) {
    const declared = plugin.manifest.tools?.some((tool) => tool.name === toolName);
    if (declared) return plugin;
  }
  return null;
}

export function listPluginTools(host: PluginHost): string[] {
  const tools: string[] = [];
  for (const id of host.getRegisteredIds()) {
    if (!host.isPluginReady(id)) continue;
    tools.push(...(host.getRuntimeManifest(id)?.tools ?? []));
  }
  return tools;
}

/**
 * Calls a tool of a plugin. The agent sees "pluginId__toolName"; the child
 * process only knows the bare name.
 */
export async function callPluginTool(
  host: PluginHost,
  namespacedToolName: string,
  args: Record<string, unknown>,
  toolCallId?: string,
): Promise<PluginToolsCallResult> {
  const match = namespacedToolName.match(NAMESPACED_TOOL);
  const pluginId = match?.[1];
  const bareName = match?.[2] ?? namespacedToolName;
  const plugin =
    findPluginForTool(host, bareName) ?? (pluginId ? host.getPlugin(pluginId) : undefined);
  if (!plugin || !host.isPluginReady(plugin.id)) {
    return {
      ok: false,
      text: `Tool ${namespacedToolName} not found`,
      code: 'TOOL_NOT_FOUND',
      message: `Plugin for tool ${namespacedToolName} not found`,
    };
  }

  const params: PluginToolsCallParams = { name: bareName, arguments: args, toolCallId };
  return (await host.requestPlugin(
    plugin.id,
    PluginToolMethods.CALL,
    params,
  )) as PluginToolsCallResult;
}
