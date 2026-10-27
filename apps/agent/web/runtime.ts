import type { Logger, WebServerConfig } from '../../shared/types.js';
import { DEFAULT_ACCEPT_LANGUAGE, DEFAULT_USER_AGENT } from './http.js';
import { runWebSearch } from './search.js';
import { fetchWebDocument } from './fetch.js';
import type { LookupResult } from './ssrf.js';
import { createCooldown, createTtlCache } from './utils/cache.js';
import type { Cooldown, TtlCache } from './utils/cache.js';
import type {
  WebContext,
  WebDocument,
  WebFetchDocumentRequest,
  WebSearchOutcome,
  WebSearchProvider,
  WebSearchQuery,
  WebSettingsPort,
} from './types.js';

export const DEFAULT_WEB_CONFIG: WebServerConfig = {
  enabled: true,
  timeoutSearchMs: 10_000,
  timeoutFetchMs: 20_000,
  maxDownloadBytes: 2_000_000,
  userAgent: '',
  acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
  cacheTtlMs: 600_000,
};

export interface WebRuntimeDeps {
  logger: Logger;
  settings: WebSettingsPort;
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<LookupResult>;
  providers?: WebSearchProvider[];
}

export interface WebRuntime {
  readonly context: WebContext;
  readonly config: WebServerConfig;
  readonly searchCache: TtlCache<WebSearchOutcome>;
  readonly providerCooldown: Cooldown;
  search(query: WebSearchQuery): Promise<WebSearchOutcome>;
  fetchDocument(request: WebFetchDocumentRequest): Promise<WebDocument>;
}

export function createWebRuntime(config: WebServerConfig, deps: WebRuntimeDeps): WebRuntime {
  const merged = { ...DEFAULT_WEB_CONFIG, ...config };
  const context: WebContext = {
    logger: deps.logger,
    fetchImpl: deps.fetchImpl ?? fetch,
    settings: deps.settings,
    userAgent: merged.userAgent === '' ? DEFAULT_USER_AGENT : merged.userAgent,
    acceptLanguage: merged.acceptLanguage === '' ? DEFAULT_ACCEPT_LANGUAGE : merged.acceptLanguage,
    timeouts: {
      searchMs: Math.max(100, Math.round(merged.timeoutSearchMs)),
      fetchMs: Math.max(100, Math.round(merged.timeoutFetchMs)),
    },
    maxDownloadBytes: Math.max(1, Math.round(merged.maxDownloadBytes)),
  };

  const searchCache = createTtlCache<WebSearchOutcome>({ ttlMs: Math.max(0, merged.cacheTtlMs) });
  const providerCooldown = createCooldown(60_000);

  return {
    context,
    config: merged,
    searchCache,
    providerCooldown,
    search(query) {
      return runWebSearch(query, context, {
        ...(deps.providers === undefined ? {} : { providers: deps.providers }),
        cache: searchCache,
        cooldown: providerCooldown,
      });
    },
    fetchDocument(request) {
      return fetchWebDocument(request, context);
    },
  };
}
