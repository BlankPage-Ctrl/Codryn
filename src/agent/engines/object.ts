import { generateObject } from 'ai';
import type { ObjectModelConfig } from '../types/index.js';

export async function objectModel<RESULT>(config: ObjectModelConfig<RESULT>) {
  return generateObject({
    model: config.model,
    schema: config.schema,
    system: config.system,
    ...(config.prompt !== undefined
      ? { prompt: config.prompt }
      : { messages: config.messages ?? [] }),
    ...(config.reasoning ? { ...config.reasoning } : {}),
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    ...(config.abortSignal !== undefined ? { abortSignal: config.abortSignal } : {}),
  });
}
