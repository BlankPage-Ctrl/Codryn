import type { Container } from '../bootstrap.js';
import {
  buildModelListURL,
  fetchModelList,
  ModelListError,
  ProviderNotFoundError,
  type RemoteModelEntry,
} from '../providers/index.js';
import {
  mergeRemoteModel,
  modelIdCandidates,
  toRemoteModel,
  type RemoteModel,
} from '../providers/index.js';
import type { ModelsDevModel } from '../providers/index.js';
import { AppError, ApiErrorCode, AuthError, ValidationError } from '../shared/errors.js';

export type { RemoteModel, RemoteModelCapabilities } from '../providers/remote-model.js';

export interface RemoteModelListResult {
  providerType: string;
  /** The endpoint actually read, so callers can show where a catalog came from. */
  modelUrl: string;
  /** Where the request key came from: 'param' means the database was never consulted. */
  keySource: 'param' | 'stored' | 'none';
  models: RemoteModel[];
}

function mergeWithModelsDev(model: RemoteModel, fallback: ModelsDevModel): RemoteModel {
  return mergeRemoteModel(model, {
    modelId: model.modelId,
    displayName: fallback.displayName,
    contextLength: fallback.contextLength,
    maxInputTokens: fallback.maxInputTokens,
    maxOutputTokens: fallback.maxOutputTokens,
    capabilities: fallback.capabilities,
  });
}

function collectModels(entries: RemoteModelEntry[]): RemoteModel[] {
  const byId = new Map<string, RemoteModel>();
  for (const entry of entries) {
    const mapped = toRemoteModel(entry);
    const modelId = mapped.modelId.trim();
    if (!modelId) continue;
    const model = modelId === mapped.modelId ? mapped : { ...mapped, modelId };
    const existing = byId.get(modelId);
    byId.set(modelId, existing ? mergeRemoteModel(existing, model) : model);
  }
  return [...byId.values()];
}

export async function listRemoteModels(
  ctx: Container,
  params: {
    providerType: string;
    providerId?: string;
    apiKey?: string;
    baseURL?: string;
  },
): Promise<RemoteModelListResult> {
  const endpoint = ctx.providerService.getModelListEndpoint(params.providerType);
  if (!endpoint) {
    throw new ValidationError(
      `Unknown provider type: ${params.providerType}. Known types: GET /providers/types`,
    );
  }

  const paramKey = params.apiKey?.trim() || undefined;
  const paramBase = params.baseURL?.trim() || undefined;

  let apiKey: string | undefined = paramKey;
  let baseURL: string | undefined = paramBase;
  let keySource: RemoteModelListResult['keySource'] = paramKey ? 'param' : 'none';

  if (params.providerId) {
    const stored = await ctx.providerService.findProviderById(params.providerId);
    if (!stored) throw new ProviderNotFoundError(params.providerId);
    if (stored.type !== params.providerType) {
      throw new ValidationError(
        `Provider ${params.providerId} has type ${stored.type}, not ${params.providerType}`,
      );
    }
    apiKey = paramKey ?? stored.apiKey ?? undefined;
    baseURL = paramBase || stored.baseURL || undefined;
    if (!paramKey && apiKey) keySource = 'stored';
  } else if (!paramKey) {
    // An explicit key is a live fetch: skip the stored-provider lookup entirely.
    const stored = await ctx.providerService.findProviderByType(params.providerType);
    if (stored) {
      apiKey = stored.apiKey ?? undefined;
      baseURL = paramBase || stored.baseURL || undefined;
      if (apiKey) keySource = 'stored';
    }
  }
  if (!baseURL) baseURL = endpoint.defaultBaseURL;

  // Pre-fetch gate: the plugin declares whether this endpoint can be read keyless.
  if (endpoint.requiresApiKey && !apiKey) {
    throw new AuthError(
      `The ${params.providerType} model list requires an API key. Pass apiKey, or save a ${params.providerType} provider first.`,
    );
  }

  let url: string;
  try {
    url = buildModelListURL(baseURL ?? '', endpoint.path);
  } catch {
    throw new ValidationError(
      `No base URL available for ${params.providerType}. Pass baseURL, or save a provider of that type.`,
    );
  }

  // Start enrichment before the catalog request so a cold models.dev cache does not add latency.
  const modelsDevPromise = ctx.modelsDevCatalog.getModels(params.providerType);

  let entries: RemoteModelEntry[];
  try {
    entries = await fetchModelList({ url, apiKey });
  } catch (err) {
    if (err instanceof ModelListError && err.reason === 'unauthorized') {
      throw new AuthError(`${params.providerType} rejected the API key for its model list`);
    }
    throw new AppError(
      503,
      `Could not read the ${params.providerType} model list: ${
        err instanceof Error ? err.message : 'provider unavailable'
      }`,
      ApiErrorCode.PROVIDER_UNAVAILABLE,
    );
  }

  const models = collectModels(entries);
  const fallback = await modelsDevPromise;
  if (fallback.size > 0) {
    for (const model of models) {
      for (const candidate of modelIdCandidates(model.modelId)) {
        const match = fallback.get(candidate);
        if (!match) continue;
        Object.assign(model, mergeWithModelsDev(model, match));
        break;
      }
    }
  }

  return {
    providerType: params.providerType,
    modelUrl: url,
    keySource,
    models,
  };
}
