import type { Container } from '../bootstrap.js';
import { buildModelListURL, fetchModelList, ModelListError } from '../providers/index.js';
import { AppError, ApiErrorCode, AuthError, ValidationError } from '../shared/errors.js';

export interface RemoteModel {
  modelId: string;
  displayName: string | null;
}

export interface RemoteModelListResult {
  providerType: string;
  /** The endpoint actually read, so callers can show where a catalog came from. */
  modelUrl: string;
  /** Where the request key came from: 'param' means the database was never consulted. */
  keySource: 'param' | 'stored' | 'none';
  models: RemoteModel[];
}

/** Optional catalog label; providers disagree on the field name, so try in order. */
function pickDisplayName(entry: Record<string, unknown>): string | null {
  for (const field of ['name', 'friendly_name', 'display_name']) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function listRemoteModels(
  ctx: Container,
  params: { providerType: string; apiKey?: string; baseURL?: string },
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
  let keySource: RemoteModelListResult['keySource'] = 'none';

  if (paramKey) {
    // An explicit key is a live fetch: skip the stored-provider lookup entirely.
    keySource = 'param';
  } else {
    const stored = await ctx.providerService.findProviderByType(params.providerType);
    if (stored) {
      apiKey = stored.apiKey ?? undefined;
      baseURL = paramBase || stored.baseURL || undefined;
      keySource = apiKey ? 'stored' : 'none';
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

  let entries: Record<string, unknown>[];
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

  return {
    providerType: params.providerType,
    modelUrl: url,
    keySource,
    models: entries.map((entry) => ({
      modelId: String(entry.id),
      displayName: pickDisplayName(entry),
    })),
  };
}
