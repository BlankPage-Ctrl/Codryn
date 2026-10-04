import type { LanguageModel } from 'ai';
import type { CapabilityProvider, ModelCapability } from './capability.js';
import type { ProviderConfig } from './provider.js';
import type { ReasoningOptions } from './reasoning.js';
import type { ThinkingLevel } from './thinking.js';

/** A model factory speaking the agent's language. */
export type ProviderModelFactory = (modelId: string) => LanguageModel;

/** Builds an AI SDK model factory from an agent-language provider config. */
export type ResolveClientFactory = (
  type: string,
) => ((config: ProviderConfig) => ProviderModelFactory) | undefined;

export interface ReasoningOptionsArgs {
  providerType: string;
  providerName: string;
  level: ThinkingLevel;
  capability?: ModelCapability | null;
}

/** Builds reasoning options. Return undefined to use the portable default. */
export type ResolveReasoning = (args: ReasoningOptionsArgs) => ReasoningOptions | undefined;

/** Fetches a model's capability from the provider's /models index. */
export type ResolveCapability = (
  provider: CapabilityProvider,
  modelId: string,
) => Promise<ModelCapability | null>;

/** Dependencies injected into the agent by the composition root (apps/bootstrap). */
export interface AgentDependencies {
  reasoning?: ResolveReasoning;
  clients?: ResolveClientFactory;
  capability?: ResolveCapability;
}
