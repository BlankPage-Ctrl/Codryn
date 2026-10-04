import type { ProviderPlugin, ProviderTypeInfo } from './types.js';
import { openaiPlugin } from './builtin/openai.js';
import { openaiCompatiblePlugin } from './builtin/openai-compatible.js';
import { openrouterPlugin } from './builtin/openrouter.js';

const plugins = new Map<string, ProviderPlugin>();

export function registerProviderPlugin(plugin: ProviderPlugin): void {
  plugins.set(plugin.id, plugin);
}

export function getProviderPlugin(id: string): ProviderPlugin | undefined {
  return plugins.get(id);
}

export function hasProviderPlugin(id: string): boolean {
  return plugins.has(id);
}

export function listProviderPlugins(): ProviderPlugin[] {
  return [...plugins.values()];
}

export function listProviderTypes(): ProviderTypeInfo[] {
  return listProviderPlugins().map((p) => ({
    id: p.id,
    label: p.label,
    isOfficial: p.isOfficial,
    requiresBaseURL: p.requiresBaseURL,
  }));
}

let installed = false;

/**
 * Register builtin (official) provider.
 * Client/reasoning/capability dispatch reads this registry directly
 * (apps/providers/clients.ts, reasoning/, capabilities.ts) and the
 * composition root injects those adapters into the agent (see bootstrap.ts).
 * Called once from apps/bootstrap.ts. Idempotent.
 */
export function installProviderPlugins(extra: ProviderPlugin[] = []): void {
  for (const plugin of [openaiPlugin, openaiCompatiblePlugin, openrouterPlugin, ...extra]) {
    registerProviderPlugin(plugin);
  }

  installed = true;
}

export function areProviderPluginsInstalled(): boolean {
  return installed;
}
