import { parse } from 'node-html-parser';
import type { WebSearchHit } from '../../types.js';

const PARSE_OPTIONS = { lowerCaseTagName: true, comment: false } as const;

export function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function siteOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

// DuckDuckGo wraps every outbound link in //duckduckgo.com/l/?uddg=<encoded>.
export function unwrapDuckDuckGoUrl(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed === '') return null;
  const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const url = new URL(absolute);
    const wrapped = url.searchParams.get('uddg');
    const candidate = wrapped ?? absolute;
    return isHttpUrl(candidate) ? candidate : null;
  } catch {
    return isHttpUrl(absolute) ? absolute : null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): string | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=');
  try {
    const decoded = Buffer.from(withPadding, 'base64').toString('utf8');
    return decoded.includes('\u0000') ? null : decoded;
  } catch {
    return null;
  }
}

// Bing hides the destination behind /ck/a?!...&u=a1<base64url>; the "a1"
// prefix is a marker, not part of the payload.
export function unwrapBingUrl(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!isHttpUrl(trimmed)) return null;
  if (!/\/ck\/a\?/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const encoded = url.searchParams.get('u');
    if (!encoded) return trimmed;
    const payload = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    const decoded = decodeBase64Url(payload);
    return decoded && isHttpUrl(decoded) ? decoded : trimmed;
  } catch {
    return trimmed;
  }
}

function dedupe(hits: WebSearchHit[]): WebSearchHit[] {
  const seen = new Set<string>();
  const out: WebSearchHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  return out;
}

export function parseDuckDuckGoHtmlPage(html: string): WebSearchHit[] {
  const root = parse(html, PARSE_OPTIONS);
  const hits: WebSearchHit[] = [];
  for (const anchor of root.querySelectorAll('a.result__a')) {
    const url = unwrapDuckDuckGoUrl(anchor.getAttribute('href'));
    if (!url) continue;
    const title = collapseText(anchor.text);
    if (title === '') continue;
    const container = anchor.closest('div.result, article');
    const snippetEl = container?.querySelector('.result__snippet');
    const snippet = snippetEl ? collapseText(snippetEl.text) : '';
    hits.push({
      title,
      url,
      site: siteOf(url),
      ...(snippet === '' ? {} : { snippet }),
    });
  }
  return dedupe(hits);
}

export function parseDuckDuckGoLitePage(html: string): WebSearchHit[] {
  const root = parse(html, PARSE_OPTIONS);
  const hits: WebSearchHit[] = [];
  for (const anchor of root.querySelectorAll("a[class='result-link']")) {
    const url = unwrapDuckDuckGoUrl(anchor.getAttribute('href'));
    if (!url) continue;
    const title = collapseText(anchor.text);
    if (title === '') continue;
    // Lite lays the snippet out in the table row that holds the link.
    const snippetEl = anchor.closest('tr')?.nextElementSibling?.querySelector('.result-snippet');
    const snippet = snippetEl ? collapseText(snippetEl.text) : '';
    hits.push({
      title,
      url,
      site: siteOf(url),
      ...(snippet === '' ? {} : { snippet }),
    });
  }
  return dedupe(hits);
}

export function parseBingPage(html: string): WebSearchHit[] {
  const root = parse(html, PARSE_OPTIONS);
  const hits: WebSearchHit[] = [];
  for (const item of root.querySelectorAll('li.b_algo')) {
    const anchor = item.querySelector('h2 a') ?? item.querySelector('a');
    if (!anchor) continue;
    const url = unwrapBingUrl(anchor.getAttribute('href'));
    if (!url) continue;
    const title = collapseText(anchor.text);
    if (title === '') continue;
    const snippetEl = item.querySelector('.b_caption p') ?? item.querySelector('p');
    const snippet = snippetEl ? collapseText(snippetEl.text) : '';
    hits.push({
      title,
      url,
      site: siteOf(url),
      ...(snippet === '' ? {} : { snippet }),
    });
  }
  return dedupe(hits);
}
