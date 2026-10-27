import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logger } from '../../apps/shared/types.js';
import {
  defaultEngineCooldown,
  defaultWebSearchProvider,
  installWebProviders,
  listWebSearchProviders,
  runWebSearch,
  sortedWebSearchProviders,
} from '../../apps/agent/web/index.js';
import {
  parseBingPage,
  parseDuckDuckGoHtmlPage,
  parseDuckDuckGoLitePage,
  unwrapBingUrl,
  unwrapDuckDuckGoUrl,
} from '../../apps/agent/web/providers/default/page-parse.js';
import { webError } from '../../apps/agent/web/errors.js';
import { createTtlCache, createCooldown } from '../../apps/agent/web/utils/cache.js';
import type {
  WebContext,
  WebSearchOutcome,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResult,
} from '../../apps/agent/web/types.js';
import { createWebSearchTool } from '../../apps/agent/tools/web-search.js';
import { formatWebSearch, formatWebSearchError } from '../../apps/agent/tools/format.js';

const silentLogger = (): Logger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
});

const DDG_HTML_PAGE = `
<html><body><div class="web_results"><div class="result links_main_list">
  <div class="result__body">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.postgresql.org%2Fdocs%2Fcurrent%2Fsql-select.html&rut=deadbeef">SELECT &ndash; PostgreSQL Documentation</a>
    <div class="result__snippet">LATERAL items may appear in the FROM list and reference earlier items.</div>
  </div>
</div>
<div class="result"><div class="result__body">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Flat&rut=1">Lateral join guide</a>
  <div class="result__snippet">A worked example of lateral joins.</div>
</div></div>
<div class="result"><div class="result__body">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.postgresql.org%2Fdocs%2Fcurrent%2Fsql-select.html&rut=other">Duplicate of the first</a>
</div></div>
</div></body></html>`;

const DDG_LITE_PAGE = `
<html><body><table><tbody>
<tr><td>[1]</td><td><a class="result-link" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Result A</a></td></tr>
<tr><td></td><td><div class="result-snippet">Snippet A</div></td></tr>
<tr><td>[2]</td><td><a class="result-link" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Result B</a></td></tr>
<tr><td></td><td><div class="result-snippet">Snippet B</div></td></tr>
</tbody></table></body></html>`;

const BING_PAGE = `
<html><body><ol id="b_results">
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=token&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9kb2M&r=1">Doc title</a></h2>
  <div class="b_caption"><p>Bing caption for the doc.</p></div></li>
<li class="b_algo"><h2><a href="https://other.example.com/plain">Plain link</a></h2>
  <p>Fallback paragraph.</p></li>
</ol></body></html>`;

const BOT_PAGE =
  '<html><body><h1>Unfortunately, our systems have detected bot activity.</h1>' +
  '<p>Please complete the anomaly CAPTCHA to continue.</p></body></html>';

function htmlResponse(
  body: string,
  status = 200,
  contentType = 'text/html; charset=utf-8',
): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

interface FakeSearchFetch {
  fetchImpl: typeof fetch;
  calls: Recorded[];
}

function fakeSearchFetch(script: (call: Recorded) => Response): FakeSearchFetch {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const record: Recorded = {
      url: String(input),
      method: (init?.method as string) ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    };
    calls.push(record);
    return script(record);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function makeContext(fetchImpl: typeof fetch, overrides: Partial<WebContext> = {}): WebContext {
  return {
    logger: silentLogger(),
    fetchImpl,
    settings: { getValue: async () => null },
    userAgent: 'test-agent',
    acceptLanguage: 'en-US,en;q=0.8',
    timeouts: { searchMs: 5_000, fetchMs: 5_000 },
    maxDownloadBytes: 2_000_000,
    ...overrides,
  };
}

const baseQuery = (over: Partial<WebSearchQuery> = {}): WebSearchQuery => ({
  text: 'postgres lateral join',
  maxResults: 8,
  ...over,
});

test('page parse: unwraps the duckduckgo redirect link', () => {
  assert.equal(
    unwrapDuckDuckGoUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=1'),
    'https://example.com/a',
  );
  assert.equal(unwrapDuckDuckGoUrl('https://example.com/plain'), 'https://example.com/plain');
  assert.equal(unwrapDuckDuckGoUrl('//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fexample.com'), null);
  assert.equal(unwrapDuckDuckGoUrl(undefined), null);
});

test('page parse: decodes the bing /ck/a link', () => {
  assert.equal(
    unwrapBingUrl('https://www.bing.com/ck/a?!&&p=1&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9kb2M&t=1'),
    'https://example.com/doc',
  );
  assert.equal(unwrapBingUrl('https://other.example.com/plain'), 'https://other.example.com/plain');
  assert.equal(unwrapBingUrl('javascript:alert(1)'), null);
});

test('page parse: duckduckgo html results keep snippets and drop duplicate urls', () => {
  const hits = parseDuckDuckGoHtmlPage(DDG_HTML_PAGE);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.url, 'https://www.postgresql.org/docs/current/sql-select.html');
  assert.equal(hits[0]?.site, 'postgresql.org');
  assert.match(hits[0]?.snippet ?? '', /LATERAL items/);
  assert.equal(hits[1]?.snippet, 'A worked example of lateral joins.');
});

test('page parse: duckduckgo lite rows pair the link with the next row snippet', () => {
  const hits = parseDuckDuckGoLitePage(DDG_LITE_PAGE);
  assert.deepEqual(
    hits.map((h) => [h.url, h.snippet]),
    [
      ['https://example.com/a', 'Snippet A'],
      ['https://example.com/b', 'Snippet B'],
    ],
  );
});

test('page parse: bing results fall back to a plain paragraph snippet', () => {
  const hits = parseBingPage(BING_PAGE);
  assert.deepEqual(
    hits.map((h) => [h.title, h.url, h.snippet]),
    [
      ['Doc title', 'https://example.com/doc', 'Bing caption for the doc.'],
      ['Plain link', 'https://other.example.com/plain', 'Fallback paragraph.'],
    ],
  );
});

test('default provider: ddg-html posts and the engine id is reported', async () => {
  defaultEngineCooldown.clear();
  const { fetchImpl, calls } = fakeSearchFetch(() => htmlResponse(DDG_HTML_PAGE));
  const result = await defaultWebSearchProvider.search(baseQuery(), makeContext(fetchImpl));

  assert.equal(result.providerId, 'default');
  assert.equal(result.engineId, 'ddg-html');
  assert.equal(result.hits.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.url, 'https://html.duckduckgo.com/html/');
  assert.equal(calls[0]?.body, 'q=postgres+lateral+join');
});

test('default provider: falls through an anomaly challenge to lite, then to bing', async () => {
  defaultEngineCooldown.clear();
  const { fetchImpl, calls } = fakeSearchFetch((call) => {
    if (call.url.includes('html.duckduckgo.com')) return htmlResponse(BOT_PAGE, 202);
    if (call.url.includes('lite.duckduckgo.com')) return htmlResponse(BOT_PAGE);
    return htmlResponse(BING_PAGE);
  });

  const result = await defaultWebSearchProvider.search(baseQuery(), makeContext(fetchImpl));
  assert.equal(result.engineId, 'bing');
  assert.equal(calls.length, 3);
  assert.equal(result.hits[0]?.url, 'https://example.com/doc');

  // The blocked engines are cooled down, so the next query goes straight to bing.
  const second = fakeSearchFetch(() => htmlResponse(BING_PAGE));
  const retry = await defaultWebSearchProvider.search(baseQuery(), makeContext(second.fetchImpl));
  assert.equal(retry.engineId, 'bing');
  assert.equal(second.calls.length, 1);
  assert.ok(second.calls[0]?.url.includes('bing.com'));
  defaultEngineCooldown.clear();
});

test('default provider: a 200 page with no readable results is PARSE_FAILED, not empty success', async () => {
  defaultEngineCooldown.clear();
  const { fetchImpl } = fakeSearchFetch(() =>
    htmlResponse('<html><body><p>markup changed entirely</p></body></html>'),
  );
  await assert.rejects(
    defaultWebSearchProvider.search(baseQuery(), makeContext(fetchImpl)),
    (err: unknown) => {
      const e = err as { code?: string; metadata?: { engines?: Array<{ code: string }> } };
      assert.equal(e.code, 'ENGINES_EXHAUSTED');
      assert.deepEqual(
        e.metadata?.engines?.map((entry) => entry.code),
        ['PARSE_FAILED', 'PARSE_FAILED', 'PARSE_FAILED'],
      );
      return true;
    },
  );
});

test('default provider: maxResults caps the hits returned per engine', async () => {
  defaultEngineCooldown.clear();
  const { fetchImpl } = fakeSearchFetch(() => htmlResponse(DDG_HTML_PAGE));
  const result = await defaultWebSearchProvider.search(
    baseQuery({ maxResults: 1 }),
    makeContext(fetchImpl),
  );
  assert.equal(result.hits.length, 1);
});

test('provider registry: only the built-in default is installed', () => {
  installWebProviders();
  assert.equal(listWebSearchProviders().length, 1);
  assert.equal(sortedWebSearchProviders()[0]?.id, 'default');
  assert.equal(defaultWebSearchProvider.capabilities.requiresApiKey, false);
});

function stubProvider(
  id: string,
  priority: number,
  behaviour: (query: WebSearchQuery, ctx: WebContext) => Promise<WebSearchResult>,
  over: Partial<WebSearchProvider> = {},
): WebSearchProvider {
  return {
    id,
    label: id,
    priority,
    capabilities: {
      maxResultsPerQuery: 20,
      supportsRecency: true,
      supportsPaging: true,
      supportsSafeSearch: true,
      snippetsIncluded: true,
      requiresApiKey: false,
    },
    isAvailable: () => true,
    search: behaviour,
    ...over,
  };
}

const okResult = (providerId: string): WebSearchResult => ({
  providerId,
  query: 'ignored',
  hits: [{ title: 'Hit', url: 'https://example.com/hit' }],
});

test('runWebSearch: honours priority, records gaps, and caches the winner', async () => {
  let paidCalls = 0;
  let cheapCalls = 0;
  const paid = stubProvider('paid', 5, async (query) => {
    paidCalls += 1;
    return { ...okResult('paid'), query: query.text, nextOffset: query.offset };
  });
  const cheap = stubProvider('cheap', 50, async () => {
    cheapCalls += 1;
    return okResult('cheap');
  });

  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  const cache = createTtlCache<WebSearchOutcome>({ ttlMs: 60_000 });
  const cooldown = createCooldown(60_000);
  const opts = { providers: [cheap, paid], cache, cooldown };

  const first = await runWebSearch(baseQuery({ recency: 'week', offset: 10 }), ctx, opts);
  assert.equal(first.result.providerId, 'paid');
  assert.deepEqual(first.skipped, []);
  assert.equal(paidCalls, 1);
  assert.equal(cheapCalls, 0);
  assert.equal(first.result.query, 'postgres lateral join');

  const second = await runWebSearch(baseQuery({ recency: 'week', offset: 10 }), ctx, opts);
  assert.equal(second.cached, true);
  assert.equal(second.result.providerId, 'paid');
  assert.equal(paidCalls, 1);
});

test('runWebSearch: unsupported capabilities are dropped and reported, not faked', async () => {
  const captured: { query?: WebSearchQuery } = {};
  const noFreshness = stubProvider('defaultish', 10, async (query) => {
    captured.query = query;
    return okResult('defaultish');
  });
  noFreshness.capabilities.supportsRecency = false;
  noFreshness.capabilities.supportsPaging = false;
  noFreshness.capabilities.supportsSafeSearch = false;
  noFreshness.capabilities.maxResultsPerQuery = 5;

  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  const outcome = await runWebSearch(
    baseQuery({ maxResults: 20, recency: 'day', offset: 5, safeSearch: 'strict' }),
    ctx,
    { providers: [noFreshness] },
  );

  assert.deepEqual(outcome.skipped.sort(), ['maxResults', 'paging', 'recency', 'safeSearch']);
  assert.equal(captured.query?.recency, undefined);
  assert.equal(captured.query?.offset, undefined);
  assert.equal(captured.query?.safeSearch, undefined);
  assert.equal(captured.query?.maxResults, 5);
});

test('runWebSearch: a blocked provider cools down and the next one answers', async () => {
  let blockedCalls = 0;
  const blocked = stubProvider('blocked', 1, async () => {
    blockedCalls += 1;
    throw webError('BLOCKED', 'bot check');
  });
  const good = stubProvider('good', 2, async () => okResult('good'));
  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  const cooldown = createCooldown(60_000);

  const first = await runWebSearch(baseQuery(), ctx, { providers: [blocked, good], cooldown });
  assert.equal(first.result.providerId, 'good');
  assert.deepEqual(
    first.attempts.map((a) => [a.providerId, a.code]),
    [['blocked', 'BLOCKED']],
  );

  const second = await runWebSearch(baseQuery(), ctx, { providers: [blocked, good], cooldown });
  assert.equal(second.result.providerId, 'good');
  assert.equal(blockedCalls, 1);
  assert.equal(second.attempts[0]?.code, 'COOLDOWN');
});

test('runWebSearch: every failure surfaces the per-provider codes', async () => {
  const failing = [
    stubProvider('a', 1, async () => {
      throw webError('TIMEOUT', 'slow');
    }),
    stubProvider('b', 2, async () => {
      throw webError('PARSE_FAILED', 'markup');
    }),
    stubProvider('c', 3, async () => okResult('c'), { isAvailable: () => false }),
  ];
  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  await assert.rejects(runWebSearch(baseQuery(), ctx, { providers: failing }), (err: unknown) => {
    const e = err as { code?: string; metadata?: { tried?: Array<{ code: string }> } };
    assert.equal(e.code, 'ALL_PROVIDERS_FAILED');
    assert.deepEqual(
      e.metadata?.tried?.map((t) => t.code),
      ['TIMEOUT', 'PARSE_FAILED', 'UNAVAILABLE'],
    );
    return true;
  });
});

test('runWebSearch: an empty provider result is a success, and cancellation stops the chain', async () => {
  const empty = stubProvider('empty', 1, async () => ({ ...okResult('empty'), hits: [] }));
  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  const outcome = await runWebSearch(baseQuery(), ctx, { providers: [empty] });
  assert.equal(outcome.result.hits.length, 0);

  let nextCalled = false;
  const cancel = stubProvider('cancel', 1, async () => {
    throw webError('CANCELLED', 'user cancelled');
  });
  const after = stubProvider('after', 2, async () => {
    nextCalled = true;
    return okResult('after');
  });
  await assert.rejects(
    runWebSearch(baseQuery(), ctx, { providers: [cancel, after] }),
    (err: unknown) => (err as { code?: string }).code === 'CANCELLED',
  );
  assert.equal(nextCalled, false);
});

test('runWebSearch: no registered provider is a configuration error', async () => {
  const ctx = makeContext((async () => htmlResponse('')) as unknown as typeof fetch);
  await assert.rejects(
    runWebSearch(baseQuery(), ctx, { providers: [] }),
    (err: unknown) => (err as { code?: string }).code === 'NO_PROVIDER_AVAILABLE',
  );
});

test('web_search tool: formats the provider line and errors as text', async () => {
  const text = formatWebSearch({
    query: 'postgres lateral join',
    providerId: 'default',
    engineId: 'ddg-html',
    hits: [
      {
        title: 'SELECT  PostgreSQL Documentation',
        url: 'https://www.postgresql.org/docs/current/sql-select.html',
        site: 'postgresql.org',
        snippet: 'LATERAL items may appear in the FROM list.',
      },
    ],
    skipped: ['recency'],
    attempts: [{ providerId: 'default', engineId: 'bing', code: 'BLOCKED' }],
    durationMs: 1234,
    cached: false,
  });
  assert.match(
    text,
    /# web_search "postgres lateral join" — 1 result \(provider: default\/ddg-html\)/,
  );
  assert.match(text, /1\. \[SELECT/);
  assert.match(text, /recency filter was ignored/);
  assert.match(text, /default\/bing: `BLOCKED`/);

  assert.match(
    formatWebSearchError('ENGINES_EXHAUSTED', 'No built-in search engine returned results.', 'x'),
    /\*\*Error\*\*: `ENGINES_EXHAUSTED`[\s\S]*\*\*Suggestion\*\*/,
  );

  const tool = createWebSearchTool(
    {
      search: async () => {
        throw webError('OFFLINE', 'Could not resolve html.duckduckgo.com.');
      },
    },
    { projectPath: '/tmp/codryn-web-test' },
  )[0]!;
  assert.equal(tool.name, 'web_search');
  const out = await tool.execute({ query: 'anything', maxResults: 8 });
  assert.match(String(out), /`OFFLINE`/);
  assert.match(String(out), /\*\*Suggestion\*\*/);
});
