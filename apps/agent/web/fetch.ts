import { isWebError, webError, type WebError } from './errors.js';
import {
  charsetFromContentType,
  charsetFromMeta,
  classifyStatus,
  decodeBytes,
  readBoundedBody,
  redactHost,
  statusError,
  webHttpRequest,
} from './http.js';
import { assertSafeWebUrl } from './ssrf.js';
import { extractHtmlDocument } from './extract/index.js';
import { mediaType, routeContentType } from './extract/content-type.js';
import type {
  WebContext,
  WebDocument,
  WebDocumentFetcher,
  WebFetchDocumentRequest,
} from './types.js';

const MAX_REDIRECT_HOPS = 5;

interface RedirectOutcome {
  response: Response;
  finalUrl: string;
}

// Redirects are followed by hand because every hop needs its own DNS lookup and
// range check: a public URL is free to point at 169.254.169.254 on hop two.
async function openDocument(
  request: WebFetchDocumentRequest,
  ctx: WebContext,
): Promise<RedirectOutcome> {
  const guard = ctx.lookupImpl ? { lookupImpl: ctx.lookupImpl } : {};
  let url = (await assertSafeWebUrl(request.url, guard)).toString();

  for (let hop = 0; ; hop++) {
    const response = await webHttpRequest(ctx, url, {
      timeoutMs: ctx.timeouts.fetchMs,
      signal: request.signal,
    });

    if (response.status < 300 || response.status >= 400) return { response, finalUrl: url };

    const location = response.headers.get('location');
    if (!location) return { response, finalUrl: url };

    if (hop >= MAX_REDIRECT_HOPS) {
      await response.body?.cancel().catch(() => undefined);
      throw webError('TOO_MANY_REDIRECTS', `${redactHost(url)} keeps redirecting.`, {
        metadata: { hops: MAX_REDIRECT_HOPS },
      });
    }

    let nextUrl: URL;
    try {
      nextUrl = await assertSafeWebUrl(new URL(location, url).toString(), guard);
    } catch (err) {
      await response.body?.cancel().catch(() => undefined);
      throw err;
    }
    await response.body?.cancel().catch(() => undefined);
    url = nextUrl.toString();
  }
}

function unsupportedContentType(contentType: string, route: string): WebError {
  const label = contentType === '' ? 'unknown' : mediaType(contentType);
  return webError(
    'UNSUPPORTED_CONTENT_TYPE',
    `This tool only reads text documents; the response is ${label} (${route}).`,
    { metadata: { contentType: label, route } },
  );
}

async function fetchDocumentDirect(
  request: WebFetchDocumentRequest,
  ctx: WebContext,
): Promise<WebDocument> {
  const maxBytes = Math.max(1, Math.min(request.maxBytes, ctx.maxDownloadBytes));
  const { response, finalUrl } = await openDocument(request, ctx);

  const statusClass = classifyStatus(response.status);
  if (statusClass !== 'ok') {
    const code =
      statusClass === 'blocked'
        ? 'BLOCKED_BY_SITE'
        : statusClass === 'rate_limited'
          ? 'RATE_LIMITED'
          : 'HTTP_STATUS';
    throw statusError(code, finalUrl, response.status);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const route = routeContentType(contentType);
  if (route === 'pdf' || route === 'image' || route === 'binary') {
    await response.body?.cancel().catch(() => undefined);
    throw unsupportedContentType(contentType, route);
  }

  const body = await readBoundedBody(response, maxBytes);
  if (body.truncated) {
    throw webError(
      'TOO_LARGE',
      `The response is larger than the ${maxBytes} byte download cap and is not fully readable.`,
      { metadata: { maxBytes, contentType: mediaType(contentType) } },
    );
  }

  const charset = charsetFromContentType(contentType) ?? charsetFromMeta(body.bytes);
  const decoded = decodeBytes(body.bytes, charset);

  let title = '';
  let text: string;
  if (route === 'html') {
    const extraction = extractHtmlDocument(decoded, finalUrl);
    title = extraction.title;
    text = extraction.markdown;
  } else {
    text = decoded.trim();
  }

  return {
    url: request.url.trim(),
    finalUrl,
    status: response.status,
    contentType: mediaType(contentType),
    charset: charset ?? 'utf-8',
    title,
    text,
    byteLength: body.bytes.byteLength,
  };
}

// The only fetcher today: plain HTTP with the SSRF guard. A rendering proxy
// later registers as another WebDocumentFetcher without touching the tool.
export const directWebFetcher: WebDocumentFetcher = {
  id: 'direct',
  priority: 10,
  fetchDocument(request, ctx) {
    return fetchDocumentDirect(request, ctx);
  },
};

export async function fetchWebDocument(
  request: WebFetchDocumentRequest,
  ctx: WebContext,
  fetcher: WebDocumentFetcher = directWebFetcher,
): Promise<WebDocument> {
  try {
    return await fetcher.fetchDocument(request, ctx);
  } catch (err) {
    if (isWebError(err)) throw err;
    throw webError('NETWORK', `Could not fetch ${redactHost(request.url)}.`, { cause: err });
  }
}
