export type {
  WebCapabilityGap,
  WebContext,
  WebDocument,
  WebDocumentFetcher,
  WebFetchDocumentRequest,
  WebSearchAttempt,
  WebSearchCapabilities,
  WebSearchEngine,
  WebSearchHit,
  WebSearchOutcome,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchRecency,
  WebSearchResult,
  WebSettingsPort,
} from './types.js';
export { WEB_SETTINGS_KEYS } from './types.js';

export {
  isWebError,
  webError,
  webErrorMetadata,
  WEB_RETRYABLE_CODES,
  type WebError,
  type WebErrorCode,
} from './errors.js';

export {
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_USER_AGENT,
  charsetFromContentType,
  charsetFromMeta,
  classifyStatus,
  decodeBytes,
  readBoundedBody,
  redactHost,
  statusError,
  webHttpRequest,
  webRequestHeaders,
  type BoundedBody,
  type WebHttpRequestOptions,
  type WebStatusClass,
} from './http.js';

export {
  assertSafeWebUrl,
  isBlockedIpAddress,
  parseIpv4,
  parseIpv6,
  type LookupResult,
  type SsrfGuardOptions,
} from './ssrf.js';

export { webSearchCacheKey, runWebSearch, type WebSearchRunOptions } from './search.js';
export { directWebFetcher, fetchWebDocument } from './fetch.js';
export {
  createWebRuntime,
  DEFAULT_WEB_CONFIG,
  type WebRuntime,
  type WebRuntimeDeps,
} from './runtime.js';

export {
  areWebProvidersInstalled,
  getWebSearchProvider,
  hasWebSearchProvider,
  installWebProviders,
  listWebSearchProviders,
  registerWebSearchProvider,
  sortedWebSearchProviders,
  defaultWebSearchProvider,
  defaultEngines,
  defaultEngineCooldown,
  DEFAULT_ENGINE_COOLDOWN_MS,
} from './providers/index.js';

export { createCooldown, createTtlCache, type Cooldown, type TtlCache } from './utils/index.js';

export {
  extractHtmlDocument,
  extractTextDocument,
  isExtractable,
  mediaType,
  routeContentType,
  type ContentRoute,
  type HtmlExtraction,
} from './extract/index.js';
