import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logger } from '../../apps/shared/types.js';
import {
  assertSafeWebUrl,
  createWebRuntime,
  DEFAULT_WEB_CONFIG,
  extractHtmlDocument,
  fetchWebDocument,
  isBlockedIpAddress,
  routeContentType,
  webError,
} from '../../apps/agent/web/index.js';
import type { LookupResult } from '../../apps/agent/web/ssrf.js';
import type { WebContext } from '../../apps/agent/web/types.js';
import { createWebFetchTool } from '../../apps/agent/tools/web-fetch.js';
import { formatWebFetch, formatWebFetchError } from '../../apps/agent/tools/format.js';

const silentLogger = (): Logger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
});

// Only example.com/redirect.test are ever resolved here, so the guard is
// exercised without touching the real resolver.
const publicLookup = (hostname: string): Promise<LookupResult> =>
  Promise.resolve(
    hostname === 'loopback.test' ? [{ address: '127.0.0.1' }] : [{ address: '93.184.216.34' }],
  );

function makeContext(fetchImpl: typeof fetch, overrides: Partial<WebContext> = {}): WebContext {
  return {
    logger: silentLogger(),
    fetchImpl,
    lookupImpl: publicLookup,
    settings: { getValue: async () => null },
    userAgent: 'test-agent',
    acceptLanguage: 'en-US,en;q=0.8',
    timeouts: { searchMs: 5_000, fetchMs: 5_000 },
    maxDownloadBytes: 2_000_000,
    ...overrides,
  };
}

function recordingFetch(handler: (url: string) => Response): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    void init;
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

const page = (body: string, status = 200, contentType = 'text/html; charset=utf-8'): Response =>
  new Response(body, { status, headers: { 'content-type': contentType } });

test('ssrf: refuses literal private, link-local and reserved addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
  ]) {
    assert.equal(isBlockedIpAddress(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '101.64.0.1']) {
    assert.equal(isBlockedIpAddress(ip), false, `${ip} should be allowed`);
  }
  for (const ip of ['::1', 'fd00::1', 'fe80::1', '::', '2002:7f00:1::', '64:ff9b::7f00:1']) {
    assert.equal(isBlockedIpAddress(ip), true, `${ip} should be blocked`);
  }
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);
});

test('ssrf: refuses non-http schemes, bad urls, and hosts that resolve privately', async () => {
  await assert.rejects(
    assertSafeWebUrl('file:///etc/passwd'),
    (e: unknown) => (e as { code: string }).code === 'INVALID_URL',
  );
  await assert.rejects(
    assertSafeWebUrl('javascript:alert(1)'),
    (e: unknown) => (e as { code: string }).code === 'INVALID_URL',
  );
  await assert.rejects(
    assertSafeWebUrl('not a url'),
    (e: unknown) => (e as { code: string }).code === 'INVALID_URL',
  );
  await assert.rejects(
    assertSafeWebUrl('http://127.0.0.1:3000/'),
    (e: unknown) => (e as { code: string }).code === 'SSRF_BLOCKED',
  );
  await assert.rejects(
    assertSafeWebUrl('http://169.254.169.254/latest/meta-data'),
    (e: unknown) => (e as { code: string }).code === 'SSRF_BLOCKED',
  );
  await assert.rejects(
    assertSafeWebUrl('http://internal.test/a', { lookupImpl: () => Promise.resolve(['10.0.0.5']) }),
    (e: unknown) => (e as { code: string }).code === 'SSRF_BLOCKED',
  );
  await assert.rejects(
    assertSafeWebUrl('http://gone.test/', {
      lookupImpl: () => Promise.reject(new Error('ENOTFOUND')),
    }),
    (e: unknown) => (e as { code: string }).code === 'OFFLINE',
  );
  const ok = await assertSafeWebUrl('https://example.com/docs', { lookupImpl: publicLookup });
  assert.equal(ok.hostname, 'example.com');
});

test('extract: routes content types and renders html to markdown', () => {
  assert.equal(routeContentType('text/html; charset=utf-8'), 'html');
  assert.equal(routeContentType('application/json'), 'json');
  assert.equal(routeContentType('application/problem+json'), 'json');
  assert.equal(routeContentType('text/plain'), 'text');
  assert.equal(routeContentType('application/pdf'), 'pdf');
  assert.equal(routeContentType('image/png'), 'image');
  assert.equal(routeContentType('application/octet-stream'), 'binary');

  const { title, markdown } = extractHtmlDocument(
    `<html><head><title>Guide</title><script>var secret=1</script><style>p{}</style></head>
     <body><nav>menu</nav><h1>Heading</h1><p>See <a href="/a/b">the api</a> and <img src="data:image/png;base64,AAA" alt="logo">.</p>
     <ul><li>first</li><li>second</li></ul><pre><code>const x = 1;</code></pre>
     <div class="sidebar">ignore me</div></body></html>`,
    'https://example.com/docs/page',
  );
  assert.equal(title, 'Guide');
  assert.match(markdown, /Heading/);
  assert.match(markdown, /\[the api\]\(https:\/\/example\.com\/a\/b\)/);
  assert.match(markdown, /- first/);
  assert.match(markdown, /const x = 1;/);
  assert.ok(!markdown.includes('var secret'));
  assert.ok(!markdown.includes('menu'));
  assert.ok(!markdown.includes('data:image/png'));
});

test('fetch: converts an html page into a document with resolved redirects', async () => {
  const { fetchImpl, urls } = recordingFetch((url) =>
    url === 'https://example.com/start'
      ? new Response('', { status: 301, headers: { location: '/docs/page' } })
      : page(
          '<html><head><title>Docs</title></head><body><h1>Postgres</h1><p>Lateral joins.</p></body></html>',
        ),
  );

  const doc = await fetchWebDocument(
    { url: 'https://example.com/start', maxBytes: 100_000 },
    makeContext(fetchImpl),
  );
  assert.equal(doc.finalUrl, 'https://example.com/docs/page');
  assert.equal(doc.title, 'Docs');
  assert.equal(doc.contentType, 'text/html');
  assert.equal(doc.status, 200);
  assert.match(doc.text, /Postgres/);
  assert.deepEqual(urls, ['https://example.com/start', 'https://example.com/docs/page']);
});

test('fetch: a redirect that lands on a private address is refused', async () => {
  const { fetchImpl, urls } = recordingFetch(
    () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1:3000/admin' } }),
  );
  await assert.rejects(
    fetchWebDocument(
      { url: 'https://example.com/redirect', maxBytes: 1000 },
      makeContext(fetchImpl),
    ),
    (e: unknown) => (e as { code: string }).code === 'SSRF_BLOCKED',
  );
  assert.deepEqual(urls, ['https://example.com/redirect']);
});

test('fetch: a private url is refused before any request is made', async () => {
  const { fetchImpl, urls } = recordingFetch(() => page('nope'));
  await assert.rejects(
    fetchWebDocument({ url: 'http://[::1]:8080/', maxBytes: 1000 }, makeContext(fetchImpl)),
    (e: unknown) => (e as { code: string }).code === 'SSRF_BLOCKED',
  );
  assert.equal(urls.length, 0);
});

test('fetch: maps refusing statuses to their own codes', async () => {
  const cases: Array<[number, string]> = [
    [403, 'BLOCKED_BY_SITE'],
    [451, 'BLOCKED_BY_SITE'],
    [429, 'RATE_LIMITED'],
    [500, 'HTTP_STATUS'],
  ];
  for (const [status, code] of cases) {
    const { fetchImpl } = recordingFetch(() => page('<html><body>no</body></html>', status));
    await assert.rejects(
      fetchWebDocument({ url: 'https://example.com/page', maxBytes: 1000 }, makeContext(fetchImpl)),
      (e: unknown) => (e as { code: string }).code === code,
      `${status} should map to ${code}`,
    );
  }
});

test('fetch: refuses oversized and unreadable bodies', async () => {
  const big = recordingFetch(() => page(`<html><body><p>${'x'.repeat(500)}</p></body></html>`));
  await assert.rejects(
    fetchWebDocument({ url: 'https://example.com/big', maxBytes: 64 }, makeContext(big.fetchImpl)),
    (e: unknown) => (e as { code: string }).code === 'TOO_LARGE',
  );

  for (const type of ['application/pdf', 'image/png', 'application/octet-stream']) {
    const { fetchImpl } = recordingFetch(() => page('binary-ish', 200, type));
    await assert.rejects(
      fetchWebDocument({ url: 'https://example.com/file', maxBytes: 1000 }, makeContext(fetchImpl)),
      (e: unknown) => (e as { code: string }).code === 'UNSUPPORTED_CONTENT_TYPE',
      `${type} should be unsupported`,
    );
  }
});

test('fetch: json stays raw and meta charset wins over the missing header', async () => {
  const json = recordingFetch(() => page('{"a": 1}', 200, 'application/json'));
  const doc = await fetchWebDocument(
    { url: 'https://api.example.com/v1', maxBytes: 1000 },
    makeContext(json.fetchImpl),
  );
  assert.equal(doc.text, '{"a": 1}');
  assert.equal(doc.contentType, 'application/json');
  assert.equal(doc.title, '');

  const latin = Buffer.from(
    '<meta charset="windows-1252"><title>plain</title><body><p>caf',
    'latin1',
  );
  const bytes = new Uint8Array([...latin, 0xe9, ...Buffer.from('e</p></body>')]);
  const meta = recordingFetch(
    () =>
      new Response(Buffer.from(bytes), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  );
  const decoded = await fetchWebDocument(
    { url: 'https://example.com/charset', maxBytes: 1000 },
    makeContext(meta.fetchImpl),
  );
  // windows-1252 0xe9 is e-acute, which utf-8 would have mangled.
  assert.match(decoded.text, /caf\xe9e/);
});

test('fetch: follows at most five redirects', async () => {
  const { fetchImpl, urls } = recordingFetch(
    () =>
      new Response('', {
        status: 302,
        headers: { location: `https://example.com/next/${urls.length}` },
      }),
  );
  await assert.rejects(
    fetchWebDocument({ url: 'https://example.com/loop', maxBytes: 1000 }, makeContext(fetchImpl)),
    (e: unknown) => (e as { code: string }).code === 'TOO_MANY_REDIRECTS',
  );
  assert.equal(urls.length, 6);
});

test('fetch: a transport throw becomes a network error', async () => {
  const fetchImpl = (async () => {
    throw Object.assign(new Error('socket hang up'), { name: 'Error' });
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchWebDocument({ url: 'https://example.com/page', maxBytes: 1000 }, makeContext(fetchImpl)),
    (e: unknown) => (e as { code: string }).code === 'NETWORK',
  );
});

test('web_fetch tool: formats the document and the refusal reasons', async () => {
  const formatted = formatWebFetch({
    url: 'https://example.com/a',
    finalUrl: 'https://example.com/b',
    status: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    title: 'Doc title',
    text: '# Heading\n\nbody text',
    byteLength: 2048,
  });
  assert.match(formatted, /# web_fetch "Doc title"/);
  assert.match(formatted, /- URL: `https:\/\/example\.com\/b`/);
  assert.match(formatted, /- Requested: `https:\/\/example\.com\/a`/);
  assert.match(formatted, /- Downloaded: 2kb/);
  assert.match(formatted, /## Content/);

  const error = formatWebFetchError(
    'BLOCKED_BY_SITE',
    'example.com responded with HTTP 403.',
    'https://x',
  );
  assert.match(error, /\*\*Error\*\*: `BLOCKED_BY_SITE`/);
  assert.match(error, /\*\*Suggestion\*\*: The site rejects direct fetches/);

  const runtime = createWebRuntime(DEFAULT_WEB_CONFIG, {
    logger: silentLogger(),
    settings: { getValue: async () => null },
    fetchImpl: (async () => {
      throw webError('OFFLINE', 'Could not resolve example.com.');
    }) as unknown as typeof fetch,
  });
  const tool = createWebFetchTool(runtime, { projectPath: '/tmp' })[0]!;
  assert.equal(tool.name, 'web_fetch');
  const out = await tool.execute({ url: 'https://example.com/doc', maxChars: 1000 });
  assert.match(String(out), /`OFFLINE`/);
  assert.equal(runtime.context.userAgent.includes('Chrome'), true);
});
