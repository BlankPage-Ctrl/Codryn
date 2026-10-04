import type { ProviderConfig, ProviderModelFactory } from '../../src/agent/types/index.js';
import { getProviderPlugin } from './registry.js';

/**
 * Adapter-side client dispatcher. Resolves a plugin for the instance type
 * and builds its model factory. Unknown types throw - the agent domain never
 * enumerates provider kinds.
 */
export function resolveClientFactory(type: string) {
  const plugin = getProviderPlugin(type);
  if (!plugin) {
    throw new Error(
      `No provider adapter installed for type "${type}". ` +
        'Register a plugin via registerProviderPlugin() (see GET /providers/types).',
    );
  }
  return (config: ProviderConfig): ProviderModelFactory => plugin.createClient(config);
}
