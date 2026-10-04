import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { buildOpenAIOptions } from '../reasoning/builders/index.js';
import type { ProviderConfig } from '../../../src/agent/types/index.js';
import type { ProviderPlugin } from '../types.js';

export const openaiPlugin: ProviderPlugin = {
  id: 'openai',
  label: 'OpenAI',
  isOfficial: true,
  requiresBaseURL: false,
  configSchema: z
    .object({
      apiKey: z.string().optional(),
      baseURL: z.string().optional(),
    })
    .strict(),
  createClient(config: ProviderConfig) {
    return createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  },
  buildReasoningOptions({ level, capability }) {
    return buildOpenAIOptions({ level, capability });
  },
};
