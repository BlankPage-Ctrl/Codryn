import { generateText, type ToolSet } from 'ai';
import type { GenerateModelConfig } from '../types/index.js';

export async function generateModel<T extends ToolSet = ToolSet>(config: GenerateModelConfig<T>) {
  return generateText({
    model: config.model,
    system: config.system,
    ...(config.maxOutputTokens != null ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(config.prompt !== undefined
      ? { prompt: config.prompt }
      : { messages: config.messages ?? [] }),
    ...(config.reasoning ? { ...config.reasoning } : {}),
    ...(config.tools ? { tools: config.tools } : {}),
    ...(config.stopWhen ? { stopWhen: config.stopWhen } : {}),
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    ...(config.abortSignal !== undefined ? { abortSignal: config.abortSignal } : {}),
  });
}
