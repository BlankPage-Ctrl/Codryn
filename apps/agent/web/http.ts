import { isWebError, webError, type WebError, type WebErrorCode } from './errors.js';
import type { WebContext } from './types.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.8';

const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export interface WebHttpRequestOptions {
  timeoutMs: number;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  accept?: string;
  signal?: AbortSignal;
  // Manual by default: callers must re-run the SSRF check on every hop.
  redirect?: 'manual' | 'follow';
}

export function webRequestHeaders(
  ctx: WebContext,
  opts: Partial<WebHttpRequestOptions> = {},
): Record<string, string> {
  return {
    'User-Agent': ctx.userAgent || DEFAULT_USER_AGENT,
    'Accept-Language': ctx.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE,
    Accept: opts.accept ?? DEFAULT_ACCEPT,
    ...opts.headers,
  };
}

function classifyRequestError(
  err: unknown,
  caller: AbortSignal | undefined,
  url: string,
): WebError {
  // An injected fetch port may already speak WebError; do not relabel it.
  if (isWebError(err)) return err;
  if (caller?.aborted) {
    return webError('CANCELLED', `Request to ${url} was cancelled.`, { cause: err });
  }
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError') {
    return webError('TIMEOUT', `Request to ${url} timed out.`, { cause: err });
  }
  if (e?.name === 'AbortError') {
    return webError('CANCELLED', `Request to ${url} was aborted.`, { cause: err });
  }
  const dnsFail = e?.cause?.code === 'ENOTFOUND' || e?.cause?.code === 'EAI_AGAIN';
  return webError(
    dnsFail ? 'OFFLINE' : 'NETWORK',
    dnsFail ? `Could not resolve ${redactHost(url)}.` : `Request to ${url} failed.`,
    { cause: err },
  );
}

export function redactHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function webHttpRequest(
  ctx: WebContext,
  url: string,
  opts: WebHttpRequestOptions,
): Promise<Response> {
  const timeout = AbortSignal.timeout(Math.max(100, Math.round(opts.timeoutMs)));
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await ctx.fetchImpl(url, {
      method: opts.method ?? 'GET',
      redirect: opts.redirect ?? 'manual',
      headers: webRequestHeaders(ctx, opts),
      ...(opts.body === undefined ? {} : { body: opts.body }),
      signal,
    });
  } catch (err) {
    throw classifyRequestError(err, opts.signal, url);
  }

  return res;
}

export interface BoundedBody {
  bytes: Uint8Array;
  truncated: boolean;
}

export async function readBoundedBody(res: Response, maxBytes: number): Promise<BoundedBody> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength <= maxBytes) return { bytes: buffer, truncated: false };
    return { bytes: buffer.subarray(0, maxBytes), truncated: true };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      const room = maxBytes - total;
      if (room > 0) {
        chunks.push(value.subarray(0, room));
        total += room;
      }
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  if (truncated) {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: out, truncated };
}

const CHARSET_RE = /charset\s*=\s*["']?\s*([\w.-]+)/i;

export function charsetFromContentType(contentType: string): string | null {
  const match = CHARSET_RE.exec(contentType);
  return match ? match[1].toLowerCase() : null;
}

// Meta sniffing needs a byte window that is ASCII-compatible before decoding.
export function charsetFromMeta(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const match = CHARSET_RE.exec(head);
  return match ? match[1].toLowerCase() : null;
}

export function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const label = charset ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export type WebStatusClass = 'ok' | 'blocked' | 'rate_limited' | 'error';

export function classifyStatus(status: number): WebStatusClass {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 403 || status === 451) return 'blocked';
  if (status === 429) return 'rate_limited';
  return 'error';
}

export function statusError(code: WebErrorCode, url: string, status: number): WebError {
  return webError(code, `${redactHost(url)} responded with HTTP ${status}.`, {
    statusCode: status,
    metadata: { status },
  });
}
