import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { buildOpenAICompatibleOptions } from '../reasoning/builders/index.js';
import type { ProviderConfig } from '../../../src/agent/types/index.js';
import type { ProviderPlugin } from '../types.js';

export const openaiCompatiblePlugin: ProviderPlugin = {
  id: 'openai-compatible',
  label: 'OpenAI Compatible',
  isOfficial: true,
  requiresBaseURL: true,
  configSchema: z
    .object({
      apiKey: z.string().optional(),
      baseURL: z.string().min(1, 'baseURL is required for openai-compatible providers'),
    })
    .strict(),
  createClient(config: ProviderConfig) {
    if (!config.baseURL) {
      throw new Error('baseURL is required for openai-compatible providers');
    }
    return createOpenAICompatible({
      name: config.name || 'custom',
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  },
  buildReasoningOptions({ level, capability, providerName }) {
    return buildOpenAICompatibleOptions({ level, capability, providerName });
  },
};
