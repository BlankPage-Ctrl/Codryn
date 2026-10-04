import type { ModelCapability } from './capability.js';
import type { ThinkingLevel } from './thinking.js';

export type PortableReasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ReasoningOptions {
  reasoning?: PortableReasoning;
  providerOptions?: Record<string, ProviderReasoningOptions>;
}

export type ProviderReasoningOptions = {
  reasoningEffort?: string;
  include?: string[];
  chat_template_kwargs?: ChatTemplateKwargs;
  reasoning?: {
    effort?: 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
    max_tokens?: number;
    enabled?: boolean;
    exclude?: boolean;
  };
};

export type ChatTemplateKwargs = {
  enable_thinking?: boolean;
};

export interface ReasoningFallbackOptions {
  capability?: ModelCapability | null;
  level?: ThinkingLevel;
}
