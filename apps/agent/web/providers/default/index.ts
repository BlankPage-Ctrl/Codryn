import { isWebError, webError } from '../../errors.js';
import type {
  WebContext,
  WebSearchAttempt,
  WebSearchCapabilities,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResult,
} from '../../types.js';
import { defaultEngineCooldown, defaultEngines } from './engines.js';

const COOLDOWN_CODES: ReadonlySet<string> = new Set(['BLOCKED', 'RATE_LIMITED']);

export const DEFAULT_WEB_SEARCH_PROVIDER_ID = 'default';

const capabilities: WebSearchCapabilities = {
  maxResultsPerQuery: 20,
  // Scraped pages expose no reliable freshness or offset parameter, so the
  // provider advertises the gap instead of pretending to honour it.
  supportsRecency: false,
  supportsPaging: false,
  supportsSafeSearch: false,
  snippetsIncluded: true,
  requiresApiKey: false,
};

async function searchThroughEngines(
  query: WebSearchQuery,
  ctx: WebContext,
): Promise<WebSearchResult> {
  const attempts: WebSearchAttempt[] = [];

  for (const engine of defaultEngines) {
    if (defaultEngineCooldown.isCoolingDown(engine.id)) {
      attempts.push({
        providerId: DEFAULT_WEB_SEARCH_PROVIDER_ID,
        engineId: engine.id,
        code: 'COOLDOWN',
      });
      continue;
    }
    try {
      const hits = await engine.search(query, ctx);
      return {
        providerId: DEFAULT_WEB_SEARCH_PROVIDER_ID,
        engineId: engine.id,
        query: query.text,
        hits,
      };
    } catch (err) {
      if (!isWebError(err)) throw err;
      if (err.code === 'CANCELLED') throw err;
      if (COOLDOWN_CODES.has(err.code)) defaultEngineCooldown.block(engine.id);
      attempts.push({
        providerId: DEFAULT_WEB_SEARCH_PROVIDER_ID,
        engineId: engine.id,
        code: err.code,
      });
      ctx.logger.warn(
        { engine: engine.id, code: err.code, err },
        'web search: built-in engine failed, trying next',
      );
    }
  }

  throw webError('ENGINES_EXHAUSTED', 'No built-in search engine returned results.', {
    metadata: { engines: attempts },
  });
}

// Written against the same contract a paid adapter will use: no built-in
// shortcut, and the caller only ever sees providerId plus engineId.
export const defaultWebSearchProvider: WebSearchProvider = {
  id: DEFAULT_WEB_SEARCH_PROVIDER_ID,
  label: 'Codryn built-in (keyless)',
  priority: 10,
  capabilities,
  isAvailable() {
    return true;
  },
  search(query, ctx) {
    return searchThroughEngines(query, ctx);
  },
};
