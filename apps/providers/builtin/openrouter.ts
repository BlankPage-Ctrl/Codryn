import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { buildOpenRouterOptions } from '../reasoning/builders/index.js';
import type { ProviderConfig } from '../../../src/agent/types/index.js';
import type { ProviderPlugin } from '../types.js';

export const openrouterPlugin: ProviderPlugin = {
  id: 'openrouter',
  label: 'OpenRouter',
  isOfficial: true,
  requiresBaseURL: false,
  configSchema: z
    .object({
      apiKey: z.string().optional(),
      baseURL: z.string().optional(),
    })
    .strict(),
  createClient(config: ProviderConfig) {
    return createOpenRouter({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  },
  buildReasoningOptions({ level, capability, providerName }) {
    return buildOpenRouterOptions({ level, capability, providerName });
  },
};
