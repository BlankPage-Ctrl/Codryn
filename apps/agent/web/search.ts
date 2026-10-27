import { isWebError, webError } from './errors.js';
import type {
  WebCapabilityGap,
  WebContext,
  WebSearchAttempt,
  WebSearchCapabilities,
  WebSearchOutcome,
  WebSearchProvider,
  WebSearchQuery,
} from './types.js';
import { listWebSearchProviders } from './providers/index.js';
import type { Cooldown, TtlCache } from './utils/cache.js';

const PROVIDER_COOLDOWN_CODES: ReadonlySet<string> = new Set(['BLOCKED', 'RATE_LIMITED']);

export interface WebSearchRunOptions {
  providers?: WebSearchProvider[];
  cache?: TtlCache<WebSearchOutcome>;
  cooldown?: Cooldown;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function webSearchCacheKey(query: WebSearchQuery): string {
  return [
    'web-search:v1',
    normalizeText(query.text).toLowerCase(),
    String(query.maxResults),
    String(query.offset ?? 0),
    query.recency ?? '-',
    query.locale ?? '-',
    query.safeSearch ?? '-',
  ].join('|');
}

// Filters the provider cannot honour are dropped and reported instead of being
// guessed at, so the model learns the result is not freshness-scoped.
function applyCapabilities(
  query: WebSearchQuery,
  caps: WebSearchCapabilities,
): { forward: WebSearchQuery; skipped: WebCapabilityGap[] } {
  const skipped: WebCapabilityGap[] = [];
  const forward: WebSearchQuery = { ...query };

  if (forward.maxResults > caps.maxResultsPerQuery) {
    forward.maxResults = caps.maxResultsPerQuery;
    skipped.push('maxResults');
  }
  if (forward.recency && !caps.supportsRecency) {
    delete forward.recency;
    skipped.push('recency');
  }
  if (forward.offset !== undefined && !caps.supportsPaging) {
    delete forward.offset;
    skipped.push('paging');
  }
  if (forward.safeSearch && !caps.supportsSafeSearch) {
    delete forward.safeSearch;
    skipped.push('safeSearch');
  }
  return { forward, skipped };
}

export async function runWebSearch(
  query: WebSearchQuery,
  ctx: WebContext,
  opts: WebSearchRunOptions = {},
): Promise<WebSearchOutcome> {
  const key = webSearchCacheKey(query);
  const cached = opts.cache?.get(key);
  if (cached) {
    return { ...cached, cached: true, attempts: [], skipped: [], durationMs: 0 };
  }

  // Priority belongs to the contract, so the chain orders it here instead of
  // trusting whoever handed over the provider list.
  const providers = [...(opts.providers ?? listWebSearchProviders())].sort(
    (a, b) => a.priority - b.priority,
  );
  if (providers.length === 0) {
    throw webError('NO_PROVIDER_AVAILABLE', 'No web search provider is registered.');
  }

  const normalized: WebSearchQuery = { ...query, text: normalizeText(query.text) };
  const startedAt = Date.now();
  const attempts: WebSearchAttempt[] = [];

  for (const provider of providers) {
    if (opts.cooldown?.isCoolingDown(provider.id)) {
      attempts.push({ providerId: provider.id, code: 'COOLDOWN' });
      continue;
    }

    let available: boolean;
    try {
      available = await provider.isAvailable(ctx);
    } catch (err) {
      ctx.logger.error({ err, provider: provider.id }, 'web search: availability check failed');
      attempts.push({ providerId: provider.id, code: 'UNAVAILABLE' });
      continue;
    }
    if (!available) {
      attempts.push({ providerId: provider.id, code: 'UNAVAILABLE' });
      continue;
    }

    const { forward, skipped } = applyCapabilities(normalized, provider.capabilities);
    try {
      const result = await provider.search(forward, ctx);
      const outcome: WebSearchOutcome = {
        result,
        skipped,
        attempts,
        durationMs: Date.now() - startedAt,
        cached: false,
      };
      opts.cache?.set(key, outcome);
      return outcome;
    } catch (err) {
      if (isWebError(err)) {
        if (err.code === 'CANCELLED') throw err;
        if (PROVIDER_COOLDOWN_CODES.has(err.code)) opts.cooldown?.block(provider.id);
        attempts.push({ providerId: provider.id, code: err.code });
        ctx.logger.warn({ err, provider: provider.id }, 'web search: provider failed');
      } else {
        attempts.push({ providerId: provider.id, code: 'UNKNOWN' });
        ctx.logger.error({ err, provider: provider.id }, 'web search: provider threw');
      }
    }
  }

  throw webError('ALL_PROVIDERS_FAILED', 'Every web search provider failed for this query.', {
    metadata: { tried: attempts },
  });
}
