import { generateModel } from './engines/generate.js';
import { objectModel } from './engines/object.js';
import { streamModel } from './engines/stream.js';
import { runAgentLoop } from './loop/agent.js';
import { withReasoningFallback } from './reasoning/fallback.js';
import type {
  AgentDependencies,
  ModelCapability,
  ThinkingLevel,
  ReasoningOptions,
  ResolvedModel,
} from './types/index.js';
import type { AgentClient } from './types/client.js';

/** Portable default - used when the composition root injects no reasoning adapter. */
function defaultReasoning(level: ThinkingLevel): ReasoningOptions {
  return {
    reasoning: level === 'none' ? 'none' : level === 'default' ? 'medium' : level,
  };
}

export function createAgent(deps: AgentDependencies = {}): AgentClient {
  async function resolveCapability(
    model: ResolvedModel,
    capability?: ModelCapability | null,
  ): Promise<ModelCapability | null> {
    if (capability !== undefined) return capability;
    const resolve = deps.capability;
    if (!resolve) return null;
    return resolve(model.providerConfig, model.modelId);
  }

  function buildModel(model: ResolvedModel) {
    const resolve = deps.clients;
    if (!resolve) {
      throw new Error(
        `No provider adapter installed for type "${model.providerConfig.type}". ` +
          'The composition root must inject AgentDependencies.clients.',
      );
    }
    const factory = resolve(model.providerConfig.type);
    if (!factory) {
      throw new Error(`No provider adapter installed for type "${model.providerConfig.type}".`);
    }
    return factory(model.providerConfig)(model.modelId);
  }

  function buildReasoning(
    model: ResolvedModel,
    level: ThinkingLevel,
    capability: ModelCapability | null,
  ): ReasoningOptions {
    const custom = deps.reasoning?.({
      providerType: model.providerConfig.type,
      providerName: model.providerConfig.name || 'custom',
      level,
      capability,
    });
    if (custom) return custom;
    return defaultReasoning(level);
  }

  return {
    stream: async (options) => {
      const capability = await resolveCapability(options.model, options.capability);
      const model = buildModel(options.model);
      return withReasoningFallback(
        (level) =>
          streamModel({
            model,
            system: options.system,
            messages: options.messages,
            tools: options.tools,
            stopWhen: options.stopWhen,
            onChunk: options.onChunk,
            onError: options.onError,
            onFinish: options.onFinish,
            onAbort: options.onAbort,
            onStepFinish: options.onStepFinish,
            maxRetries: options.maxRetries,
            timeout: options.timeout,
            abortSignal: options.abortSignal,
            reasoning: buildReasoning(options.model, level, capability),
          }),
        { capability, level: options.thinkingLevel },
      );
    },

    loop: async (options) => {
      const capability = await resolveCapability(options.model, options.capability);
      const model = buildModel(options.model);
      return withReasoningFallback(
        (level) =>
          runAgentLoop({
            model,
            system: options.system,
            messages: options.messages,
            tools: options.tools,
            stopWhen: options.stopWhen,
            onChunk: options.onChunk,
            onError: options.onError,
            onFinish: options.onFinish,
            onAbort: options.onAbort,
            onStepFinish: options.onStepFinish,
            maxRetries: options.maxRetries,
            timeout: options.timeout,
            abortSignal: options.abortSignal,
            reasoning: buildReasoning(options.model, level, capability),
          }),
        { capability, level: options.thinkingLevel },
      );
    },

    generate: async (options) => {
      const capability = await resolveCapability(options.model, options.capability);
      return generateModel({
        model: buildModel(options.model),
        system: options.system,
        messages: options.messages,
        prompt: options.prompt,
        tools: options.tools,
        stopWhen: options.stopWhen,
        maxRetries: options.maxRetries,
        timeout: options.timeout,
        abortSignal: options.abortSignal,
        reasoning: buildReasoning(options.model, options.thinkingLevel ?? 'default', capability),
      });
    },

    object: async (options) => {
      const capability = await resolveCapability(options.model, options.capability);
      return objectModel({
        model: buildModel(options.model),
        schema: options.schema,
        system: options.system,
        prompt: options.prompt,
        messages: options.messages,
        maxRetries: options.maxRetries,
        abortSignal: options.abortSignal,
        reasoning: buildReasoning(options.model, options.thinkingLevel ?? 'default', capability),
      });
    },
  };
}
