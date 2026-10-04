import { z } from 'zod';
import type { CapabilityProvider, ModelCapability } from '../../src/agent/types/index.js';

/**
 * Foreign /models index shapes - owned by the adapter layer (apps/), parsed
 * at the boundary into the agent's ModelCapability language.
 */

const modelCapabilitySchema = z.object({
  reasoning: z.boolean().default(false),
  thinkingFormat: z.string().nullable().default(null),
  thinkingCanDisable: z.boolean().default(true),
  thinkingRange: z.array(z.string()).nullable().default(null),
});

const openAICompatibleModelSchema = z.object({
  id: z.string(),
  capabilities: modelCapabilitySchema.optional(),
});

const modelCapabilityIndexSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
});

const openRouterReasoningSchema = z.object({
  supported_efforts: z.array(z.string()).nullable().optional(),
  default_effort: z.string().nullable().optional(),
  default_enabled: z.boolean().optional(),
  supports_max_tokens: z.boolean().optional(),
  mandatory: z.boolean().optional(),
});

const openRouterModelSchema = z.object({
  id: z.string(),
  reasoning: openRouterReasoningSchema.optional(),
});

function openAICompatibleModelToCapability(entry: unknown): ModelCapability | null {
  const parsed = openAICompatibleModelSchema.safeParse(entry);
  if (!parsed.success) return null;
  return parsed.data.capabilities ?? null;
}

function openRouterModelToCapability(entry: unknown): ModelCapability | null {
  const parsed = openRouterModelSchema.safeParse(entry);
  if (!parsed.success) return null;
  const reasoning = parsed.data.reasoning;
  if (!reasoning) return null;
  return {
    reasoning: true,
    thinkingFormat: reasoning.supports_max_tokens ? 'token-budget' : 'effort',
    thinkingCanDisable: !reasoning.mandatory,
    thinkingRange: reasoning.supported_efforts ?? null,
  };
}

interface CacheEntry {
  fetchedAt: number;
  models: Map<string, ModelCapability>;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

async function fetchModelCapabilities(
  provider: CapabilityProvider,
): Promise<Map<string, ModelCapability> | null> {
  if (!provider.baseURL) return null;

  const url = `${normalizeBaseURL(provider.baseURL)}/models`;
  try {
    const res = await fetch(url, {
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const parsed = modelCapabilityIndexSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    const models = new Map<string, ModelCapability>();
    for (const entry of parsed.data.data ?? []) {
      const compatible = openAICompatibleModelToCapability(entry);
      if (compatible) {
        models.set(entry.id, compatible);
        continue;
      }
      const openRouter = openRouterModelToCapability(entry);
      if (openRouter) models.set(entry.id, openRouter);
    }
    return models;
  } catch {
    return null;
  }
}

export async function getModelCapability(
  provider: CapabilityProvider,
  modelId: string,
): Promise<ModelCapability | null> {
  if (!provider.baseURL) return null;

  const key = `${provider.id}:${normalizeBaseURL(provider.baseURL)}`;
  const now = Date.now();
  let entry = cache.get(key);

  if (!entry || now - entry.fetchedAt > TTL_MS) {
    const index = await fetchModelCapabilities(provider);
    if (!index) return null;
    entry = { fetchedAt: now, models: index };
    cache.set(key, entry);
  }

  return entry.models.get(modelId) ?? null;
}
