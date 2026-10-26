import type { Logger } from '../shared/types.js';
import { getProviderPlugin, listProviderPlugins } from './registry.js';
import type { RemoteModelCapabilities } from './remote-model.js';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 5000;

export interface ModelsDevModel {
  displayName: string | null;
  contextLength: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  capabilities: RemoteModelCapabilities | null;
}

export interface ModelsDevCatalog {
  getModels(providerType: string): Promise<Map<string, ModelsDevModel>>;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function readCapabilities(value: RecordValue): RemoteModelCapabilities | null {
  const modalities = isRecord(value.modalities) ? value.modalities : null;
  const inputModalities = stringArray(modalities?.input);
  const outputModalities = stringArray(modalities?.output);
  const capabilities: RemoteModelCapabilities = {
    reasoning: readBool(value.reasoning),
    toolCalling: readBool(value.tool_call),
    structuredOutput: readBool(value.structured_output),
    vision:
      (inputModalities ? inputModalities.some((m) => m.toLowerCase() === 'image') : null) ??
      readBool(value.attachment),
    inputModalities,
    outputModalities,
  };
  const known = Object.values(capabilities).some((field) => field !== null);
  return known ? capabilities : null;
}

function toModelsDevModel(value: unknown): ModelsDevModel | null {
  if (!isRecord(value)) return null;
  const limit = isRecord(value.limit) ? value.limit : null;
  const contextLength = positiveInt(limit?.context);
  const maxOutputTokens = positiveInt(limit?.output);
  const explicitInput = positiveInt(limit?.input);
  const derivedInput =
    contextLength !== null && maxOutputTokens !== null && contextLength > maxOutputTokens
      ? contextLength - maxOutputTokens
      : contextLength;
  const displayName =
    typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;

  return {
    displayName,
    contextLength,
    maxInputTokens: explicitInput ?? derivedInput,
    maxOutputTokens,
    capabilities: readCapabilities(value),
  };
}

interface CacheEntry {
  fetchedAt: number;
  providers: Map<string, Map<string, ModelsDevModel>>;
}

export function createModelsDevCatalog(opts: {
  logger?: Logger;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
} = {}): ModelsDevCatalog {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  let cache: CacheEntry | null = null;
  let failedAt: number | null = null;
  let inflight: Promise<CacheEntry | null> | null = null;

  async function fetchCatalog(): Promise<CacheEntry | null> {
    try {
      const res = await fetchImpl(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`models.dev returned ${res.status} ${res.statusText}`);

      const raw: unknown = await res.json();
      if (!isRecord(raw)) throw new Error('models.dev returned an unexpected shape');

      const providers = new Map<string, Map<string, ModelsDevModel>>();
      for (const plugin of listProviderPlugins()) {
        const key = plugin.modelList.modelsDevProvider;
        if (!key) continue;
        const section = raw[key];
        if (!isRecord(section)) continue;
        const rawModels = section.models;
        if (!isRecord(rawModels)) continue;

        const models = new Map<string, ModelsDevModel>();
        for (const [id, entry] of Object.entries(rawModels)) {
          const mapped = toModelsDevModel(entry);
          if (mapped) models.set(id, mapped);
        }
        providers.set(key, models);
      }

      cache = { fetchedAt: Date.now(), providers };
      failedAt = null;
      return cache;
    } catch (err) {
      failedAt = Date.now();
      opts.logger?.debug({ err }, 'models.dev catalog unavailable; skipping enrichment');
      return null;
    }
  }

  async function load(): Promise<CacheEntry | null> {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < ttlMs) return cache;
    if (failedAt !== null && now - failedAt < FAILURE_TTL_MS) return null;
    if (inflight) return inflight;

    inflight = fetchCatalog().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    async getModels(providerType) {
      const key = getProviderPlugin(providerType)?.modelList.modelsDevProvider;
      if (!key) return new Map();
      const loaded = await load();
      return loaded?.providers.get(key) ?? new Map();
    },
  };
}
