import type {
  ProviderReasoningOptions,
  ReasoningOptions,
  ThinkingLevel,
} from '../../../../src/agent/types/index.js';
import { resolveReasoningLevel, toPortable, type ReasoningBuildArgs } from './shared.js';

function buildOpenRouterBody(level: ThinkingLevel): ProviderReasoningOptions {
  if (level === 'none') {
    return { reasoning: { enabled: false } };
  }
  return {
    reasoning: {
      effort: toPortable(level, 'medium'),
      enabled: true,
    },
  };
}

export function buildOpenRouterOptions({
  level,
  capability,
}: ReasoningBuildArgs): ReasoningOptions {
  const { omit, level: resolved } = resolveReasoningLevel(level, capability);
  if (omit) return {};
  return {
    providerOptions: {
      openrouter: buildOpenRouterBody(resolved),
    },
  };
}
