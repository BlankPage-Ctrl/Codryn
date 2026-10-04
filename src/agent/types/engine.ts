import type {
  LanguageModel,
  ModelMessage,
  Schema,
  StopCondition,
  StreamTextOnChunkCallback,
  StreamTextOnErrorCallback,
  TimeoutConfiguration,
  ToolSet,
} from 'ai';
import type { ReasoningOptions } from './reasoning.js';

export interface AgentRetryOptions<T extends ToolSet = ToolSet> {
  maxRetries?: number;
  timeout?: TimeoutConfiguration<T>;
  abortSignal?: AbortSignal;
}

export interface StreamModelConfig<T extends ToolSet = ToolSet> extends AgentRetryOptions<T> {
  model: LanguageModel;
  system?: string;
  messages: ModelMessage[];
  tools?: T;
  reasoning?: ReasoningOptions;
  stopWhen?: StopCondition<T> | StopCondition<T>[];
  /** Max output tokens passed to the LLM (null/undefined = provider default). */
  maxOutputTokens?: number | null;
  onChunk?: StreamTextOnChunkCallback<T>;
  onError?: StreamTextOnErrorCallback;
  onFinish?: (event: { finishReason: string; totalUsage?: unknown; steps?: unknown[] }) => unknown;
  onAbort?: (event: { steps: unknown[] }) => unknown;
  onStepFinish?: (event: {
    finishReason: string;
    toolCalls?: unknown[];
    usage?: unknown;
    response?: unknown;
    providerMetadata?: unknown;
  }) => unknown;
}

export interface GenerateModelConfig<T extends ToolSet = ToolSet> extends AgentRetryOptions<T> {
  model: LanguageModel;
  system?: string;
  messages?: ModelMessage[];
  prompt?: string;
  tools?: T;
  reasoning?: ReasoningOptions;
  stopWhen?: StopCondition<T> | StopCondition<T>[];
  /** Max output tokens passed to the LLM (null/undefined = provider default). */
  maxOutputTokens?: number | null;
}

export interface ObjectModelConfig<RESULT> extends Omit<AgentRetryOptions, 'timeout'> {
  model: LanguageModel;
  schema: Schema<RESULT>;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  reasoning?: ReasoningOptions;
}

export type AgentLoopConfig<T extends ToolSet = ToolSet> = StreamModelConfig<T> & {
  // Optional override for max steps; consumed by runAgentLoop via stopWhen
  maxSteps?: number;
};
