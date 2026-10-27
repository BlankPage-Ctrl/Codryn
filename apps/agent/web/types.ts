import type { Logger } from '../../shared/types.js';
import type { LookupResult } from './ssrf.js';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet?: string;
  site?: string;
  publishedAt?: string;
}

export interface WebSearchResult {
  providerId: string;
  // Which upstream inside this provider actually produced the hits. Single-source
  // providers leave it undefined.
  engineId?: string;
  query: string;
  hits: WebSearchHit[];
  totalEstimate?: number;
  nextOffset?: number;
}

export type WebSearchRecency = 'day' | 'week' | 'month' | 'year';

export type WebCapabilityGap = 'recency' | 'paging' | 'safeSearch' | 'maxResults';

export interface WebSearchAttempt {
  providerId: string;
  engineId?: string;
  code: string;
}

// What runWebSearch hands the tool: the result plus enough truth about how it
// was obtained (fallbacks, dropped filters) to report it to the model.
export interface WebSearchOutcome {
  result: WebSearchResult;
  skipped: WebCapabilityGap[];
  attempts: WebSearchAttempt[];
  durationMs: number;
  cached: boolean;
}

export interface WebSearchQuery {
  text: string;
  maxResults: number;
  offset?: number;
  recency?: WebSearchRecency;
  locale?: string;
  safeSearch?: 'strict' | 'moderate' | 'off';
  signal?: AbortSignal;
}

// A provider declares what it can do; the tool may not assume it.
export interface WebSearchCapabilities {
  maxResultsPerQuery: number;
  supportsRecency: boolean;
  supportsPaging: boolean;
  supportsSafeSearch: boolean;
  snippetsIncluded: boolean;
  requiresApiKey: boolean;
}

export interface WebSearchProvider {
  readonly id: string;
  readonly label: string;
  readonly priority: number;
  readonly capabilities: WebSearchCapabilities;
  isAvailable(ctx: WebContext): boolean | Promise<boolean>;
  search(query: WebSearchQuery, ctx: WebContext): Promise<WebSearchResult>;
}

// One upstream inside a provider. Never registered on its own.
export interface WebSearchEngine {
  readonly id: string;
  search(query: WebSearchQuery, ctx: WebContext): Promise<WebSearchHit[]>;
}

export interface WebDocument {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  charset: string;
  title: string;
  text: string;
  byteLength: number;
}

export interface WebFetchDocumentRequest {
  url: string;
  maxBytes: number;
  signal?: AbortSignal;
}

export interface WebDocumentFetcher {
  readonly id: string;
  readonly priority: number;
  fetchDocument(request: WebFetchDocumentRequest, ctx: WebContext): Promise<WebDocument>;
}

export interface WebSettingsPort {
  getValue(key: string): Promise<string | null>;
}

export interface WebContext {
  logger: Logger;
  fetchImpl: typeof fetch;
  // Same injection rationale as fetchImpl: the SSRF guard needs to resolve
  // hosts, and tests must not reach the real resolver.
  lookupImpl?: (hostname: string) => Promise<LookupResult>;
  settings: WebSettingsPort;
  userAgent: string;
  acceptLanguage: string;
  timeouts: { searchMs: number; fetchMs: number };
  maxDownloadBytes: number;
}

export const WEB_SETTINGS_KEYS = {
  searchApiKey: 'websearchApiKey',
} as const;
