import type {
  ProviderReasoningOptions,
  ReasoningOptions,
  ThinkingLevel,
} from '../../../../src/agent/types/index.js';
import { resolveReasoningLevel, toPortable, type ReasoningBuildArgs } from './shared.js';

function buildOpenAICompatibleBody(level: ThinkingLevel): ProviderReasoningOptions {
  if (level === 'none') {
    return { chat_template_kwargs: { enable_thinking: false } };
  }
  return {
    reasoningEffort: toPortable(level, 'medium'),
    chat_template_kwargs: { enable_thinking: true },
  };
}

export function buildOpenAICompatibleOptions({
  level,
  capability,
  providerName,
}: ReasoningBuildArgs): ReasoningOptions {
  const { omit, level: resolved } = resolveReasoningLevel(level, capability);
  if (omit) return {};
  return {
    providerOptions: {
      [providerName ?? 'custom']: buildOpenAICompatibleBody(resolved),
    },
  };
}
