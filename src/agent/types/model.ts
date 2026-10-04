import type { ProviderConfig } from './provider.js';

export interface ModelRef {
  provider: ProviderConfig;
  modelId: string;
}

export interface ModelRefLike {
  modelId: string;
}

export type ResolvedDefaults = { providerId: string | null; modelId: string | null };

export interface ResolvedModel {
  providerConfig: ProviderConfig;
  modelId: string;
}

export type ModelResolutionErrorCode = 'no-default' | 'provider-not-found' | 'model-not-found';

export type ModelResolution =
  | { ok: true; data: ResolvedModel }
  | { ok: false; error: { code: ModelResolutionErrorCode; message: string } };
