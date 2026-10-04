import { streamText, type ToolSet } from 'ai';
import type { StreamModelConfig } from '../types/index.js';

export function streamModel<T extends ToolSet = ToolSet>(config: StreamModelConfig<T>) {
  // Cast to any to handle cross-version ai SDK Context generic complexity
  return streamText({
    model: config.model,
    system: config.system,
    messages: config.messages,
    ...(config.maxOutputTokens != null ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(config.reasoning ? { ...config.reasoning } : {}),
    ...(config.tools ? { tools: config.tools } : {}),
    ...(config.stopWhen ? { stopWhen: config.stopWhen } : {}),
    ...(config.onChunk ? { onChunk: config.onChunk } : {}),
    ...(config.onError ? { onError: config.onError } : {}),
    ...(config.onFinish ? { onFinish: config.onFinish as never } : {}),
    ...(config.onAbort ? { onAbort: config.onAbort as never } : {}),
    ...(config.onStepFinish ? { onStepFinish: config.onStepFinish as never } : {}),
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    ...(config.abortSignal !== undefined ? { abortSignal: config.abortSignal } : {}),
  } as never);
}
