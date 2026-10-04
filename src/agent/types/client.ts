import type { generateText, streamText, ToolSet } from 'ai';
import type { GenerateObjectResult } from 'ai';
import type { ModelCapability } from './capability.js';
import type { GenerateModelConfig, ObjectModelConfig, StreamModelConfig } from './engine.js';
import type { ResolvedModel } from './model.js';
import type { ReasoningOptions } from './reasoning.js';
import type { ThinkingLevel } from './thinking.js';

type AgentEngineConfig<CONFIG> = Omit<CONFIG, 'model' | 'reasoning'> & {
  model: ResolvedModel;
  thinkingLevel?: ThinkingLevel;
  capability?: ModelCapability | null;
  reasoning?: ReasoningOptions;
};

export type AgentStreamOptions<T extends ToolSet = ToolSet> = AgentEngineConfig<
  StreamModelConfig<T>
>;

export type AgentGenerateOptions<T extends ToolSet = ToolSet> = AgentEngineConfig<
  GenerateModelConfig<T>
>;

export type AgentObjectOptions<RESULT> = AgentEngineConfig<ObjectModelConfig<RESULT>>;

export interface AgentClient {
  stream(options: AgentStreamOptions): Promise<ReturnType<typeof streamText>>;
  loop(options: AgentStreamOptions): Promise<ReturnType<typeof streamText>>;
  generate(options: AgentGenerateOptions): ReturnType<typeof generateText>;
  object<RESULT>(options: AgentObjectOptions<RESULT>): Promise<GenerateObjectResult<RESULT>>;
}
