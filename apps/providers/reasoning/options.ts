import { toPortable } from './builders/index.js';
import type { ReasoningOptions, ReasoningOptionsArgs } from '../../../src/agent/types/index.js';
import { getProviderPlugin } from '../registry.js';

/**
 * Adapter-side reasoning dispatch. Plugin implementations win; unknown types
 * fall back to the portable default.
 */
export function buildReasoningOptions(args: ReasoningOptionsArgs): ReasoningOptions {
  const { providerType, providerName, level, capability } = args;

  const plugin = getProviderPlugin(providerType);
  const custom = plugin?.buildReasoningOptions?.({ level, capability, providerName });
  if (custom) return custom;

  return {
    reasoning: toPortable(level, 'medium'),
  };
}
