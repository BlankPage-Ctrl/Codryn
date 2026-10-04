import type { ReasoningOptions } from '../../../../src/agent/types/index.js';
import { toPortable, type ReasoningBuildArgs } from './shared.js';

export const OPENAI_REASONING_ENCRYPTED_INCLUDE = 'reasoning.encrypted_content';

export function buildOpenAIOptions({ level }: ReasoningBuildArgs): ReasoningOptions {
  const portable = toPortable(level, level === 'none' ? 'none' : 'medium');
  if (portable === 'none') return { reasoning: 'none' };
  return {
    reasoning: portable,
    providerOptions: {
      openai: { include: [OPENAI_REASONING_ENCRYPTED_INCLUDE] },
    },
  };
}
