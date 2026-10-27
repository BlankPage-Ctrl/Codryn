import type { WebSearchProvider } from '../types.js';
import { defaultWebSearchProvider } from './default/index.js';

const providers = new Map<string, WebSearchProvider>();

export function registerWebSearchProvider(provider: WebSearchProvider): void {
  providers.set(provider.id, provider);
}

export function getWebSearchProvider(id: string): WebSearchProvider | undefined {
  return providers.get(id);
}

export function hasWebSearchProvider(id: string): boolean {
  return providers.has(id);
}

export function listWebSearchProviders(): WebSearchProvider[] {
  return [...providers.values()];
}

// Lower priority runs first; equal priorities keep registration order, so the
// built-in stays last until an adapter with a key registers ahead of it.
export function sortedWebSearchProviders(): WebSearchProvider[] {
  return listWebSearchProviders().sort((a, b) => a.priority - b.priority);
}

let installed = false;

export function installWebProviders(extra: WebSearchProvider[] = []): void {
  for (const provider of [defaultWebSearchProvider, ...extra]) {
    registerWebSearchProvider(provider);
  }
  installed = true;
}

export function areWebProvidersInstalled(): boolean {
  return installed;
}

export { defaultWebSearchProvider } from './default/index.js';
export {
  DEFAULT_ENGINE_COOLDOWN_MS,
  defaultEngines,
  defaultEngineCooldown,
  defaultEngineSpecs,
} from './default/engines.js';
