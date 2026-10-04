import type { Container } from '../bootstrap.js';
import type { ModelResolution, ResolvedDefaults } from '../../src/agent/index.js';
import { toProviderConfig } from '../providers/translate.js';

async function resolveFromValues(
  ctx: Container,
  defaults: ResolvedDefaults,
): Promise<ModelResolution> {
  if (!defaults.providerId || !defaults.modelId) {
    return {
      ok: false,
      error: {
        code: 'no-default',
        message: 'No provider and model configured. Select a provider/model.',
      },
    };
  }
  const provider = await ctx.providerStore.findByIdWithModels(defaults.providerId);
  if (!provider) {
    return {
      ok: false,
      error: { code: 'provider-not-found', message: `Provider ${defaults.providerId} not found` },
    };
  }
  const model = await ctx.providerStore.findModelById(defaults.modelId);
  if (!model) {
    return {
      ok: false,
      error: { code: 'model-not-found', message: `Model ${defaults.modelId} not found` },
    };
  }
  return { ok: true, data: { providerConfig: toProviderConfig(provider), modelId: model.modelId } };
}

export async function resolveDefaultProvider(
  ctx: Container,
  defaults: ResolvedDefaults,
): Promise<ModelResolution> {
  return resolveFromValues(ctx, defaults);
}

export async function resolveChatModel(
  ctx: Container,
  chat: { provider_id?: string | null; model_id?: string | null },
  defaults: ResolvedDefaults | null = null,
): Promise<ModelResolution> {
  if (chat.provider_id && chat.model_id) {
    const provider = await ctx.providerStore.findByIdWithModels(chat.provider_id);
    if (!provider) {
      return {
        ok: false,
        error: { code: 'provider-not-found', message: `Provider ${chat.provider_id} not found` },
      };
    }
    const model = await ctx.providerStore.findModelById(chat.model_id);
    if (!model) {
      return {
        ok: false,
        error: { code: 'model-not-found', message: `Model ${chat.model_id} not found` },
      };
    }
    return {
      ok: true,
      data: { providerConfig: toProviderConfig(provider), modelId: model.modelId },
    };
  }
  if (defaults) return resolveFromValues(ctx, defaults);
  return {
    ok: false,
    error: { code: 'no-default', message: 'No provider/model on chat. Select a provider/model.' },
  };
}

// Backward compat, kept for callers that still import modelResolver
export function modelResolver(ctx: Container) {
  return { providers: ctx.providerStore };
}
