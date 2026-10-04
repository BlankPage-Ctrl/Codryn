import type { ProviderConfig } from '../../src/agent/types/index.js';
import type { ProviderLike } from './types.js';

export function toProviderConfig(provider: ProviderLike): ProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    apiKey: provider.apiKey ?? undefined,
    baseURL: provider.baseURL ?? undefined,
  };
}
