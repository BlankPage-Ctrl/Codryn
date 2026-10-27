import { isWebError, webError, type WebError } from '../../errors.js';
import {
  charsetFromContentType,
  charsetFromMeta,
  classifyStatus,
  decodeBytes,
  readBoundedBody,
  redactHost,
  statusError,
  webHttpRequest,
} from '../../http.js';
import type { WebContext, WebSearchEngine, WebSearchHit, WebSearchQuery } from '../../types.js';
import { createCooldown } from '../../utils/cache.js';
import { parseBingPage, parseDuckDuckGoHtmlPage, parseDuckDuckGoLitePage } from './page-parse.js';

export const DEFAULT_ENGINE_COOLDOWN_MS = 60_000;

export const defaultEngineCooldown = createCooldown(DEFAULT_ENGINE_COOLDOWN_MS);

const SEARCH_PAGE_MAX_BYTES = 2_000_000;

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const BING_URL = 'https://www.bing.com/search';

// Only consulted when a 2xx page parses to zero hits, so a result snippet that
// happens to mention captchas cannot trip it.
const BOT_CHECK_MARKERS = [
  'anomaly',
  'captcha',
  'unusual traffic',
  'not a robot',
  'verify you are a human',
  'enable javascript',
];

interface EngineRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
}

interface EngineSpec {
  readonly id: string;
  readonly label: string;
  build(query: WebSearchQuery): EngineRequest;
  parse(html: string): WebSearchHit[];
}

function searchParams(query: WebSearchQuery): URLSearchParams {
  return new URLSearchParams({ q: query.text });
}

const DDG_HTML: EngineSpec = {
  id: 'ddg-html',
  label: 'DuckDuckGo html',
  // POST only: a GET on this endpoint answers 202 with an anomaly challenge.
  build: (query) => ({
    url: DDG_HTML_URL,
    method: 'POST',
    body: searchParams(query).toString(),
  }),
  parse: parseDuckDuckGoHtmlPage,
};

const DDG_LITE: EngineSpec = {
  id: 'ddg-lite',
  label: 'DuckDuckGo lite',
  build: (query) => {
    const url = new URL(DDG_LITE_URL);
    for (const [key, value] of searchParams(query)) url.searchParams.append(key, value);
    return { url: url.toString(), method: 'GET' };
  },
  parse: parseDuckDuckGoLitePage,
};

const BING: EngineSpec = {
  id: 'bing',
  label: 'Bing',
  build: (query) => {
    const url = new URL(BING_URL);
    url.searchParams.set('q', query.text);
    url.searchParams.set('count', String(Math.min(20, Math.max(1, query.maxResults))));
    return { url: url.toString(), method: 'GET' };
  },
  parse: parseBingPage,
};

export const defaultEngineSpecs: readonly EngineSpec[] = [DDG_HTML, DDG_LITE, BING];

function botCheckError(url: string, status: number): WebError {
  return webError('BLOCKED', `${redactHost(url)} is serving a bot check instead of results.`, {
    statusCode: status,
    metadata: { status },
  });
}

function isBotCheckPage(html: string): boolean {
  const haystack = html.slice(0, 20_000).toLowerCase();
  return BOT_CHECK_MARKERS.some((marker) => haystack.includes(marker));
}

async function fetchSearchPage(
  request: EngineRequest,
  query: WebSearchQuery,
  ctx: WebContext,
): Promise<string> {
  const res = await webHttpRequest(ctx, request.url, {
    timeoutMs: ctx.timeouts.searchMs,
    method: request.method,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    signal: query.signal,
  });

  if (res.status === 202) throw botCheckError(request.url, res.status);
  const statusClass = classifyStatus(res.status);
  if (statusClass !== 'ok') {
    const code =
      statusClass === 'blocked'
        ? 'BLOCKED'
        : statusClass === 'rate_limited'
          ? 'RATE_LIMITED'
          : 'HTTP_STATUS';
    throw statusError(code, request.url, res.status);
  }

  const maxBytes = Math.min(SEARCH_PAGE_MAX_BYTES, Math.max(16_384, ctx.maxDownloadBytes));
  const body = await readBoundedBody(res, maxBytes);
  const contentType = res.headers.get('content-type') ?? '';
  return decodeBytes(
    body.bytes,
    charsetFromContentType(contentType) ?? charsetFromMeta(body.bytes),
  );
}

function parseSearchPage(spec: EngineSpec, html: string, url: string): WebSearchHit[] {
  let hits: WebSearchHit[];
  try {
    hits = spec.parse(html);
  } catch (err) {
    throw webError('PARSE_FAILED', `${spec.label} page could not be parsed.`, { cause: err });
  }
  if (hits.length === 0) {
    if (isBotCheckPage(html)) throw botCheckError(url, 200);
    throw webError(
      'PARSE_FAILED',
      `${spec.label} returned a page with no readable results; the markup may have changed.`,
    );
  }
  return hits;
}

function createEngine(spec: EngineSpec): WebSearchEngine {
  return {
    id: spec.id,
    async search(query, ctx) {
      const request = spec.build(query);
      let html: string;
      try {
        html = await fetchSearchPage(request, query, ctx);
      } catch (err) {
        if (isWebError(err)) throw err;
        throw webError('NETWORK', `${spec.label} request failed.`, { cause: err });
      }
      return parseSearchPage(spec, html, request.url).slice(0, query.maxResults);
    },
  };
}

// Order matters: ddg-html carries snippets and is the only keyless engine that
// held up under repeated queries, so it goes first and the rest are fallbacks.
export const defaultEngines: readonly WebSearchEngine[] = defaultEngineSpecs.map(createEngine);
