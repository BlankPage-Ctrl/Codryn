import { lookup } from 'node:dns/promises';
import { webError } from './errors.js';

export type LookupResult = Array<{ address: string } | string>;

export interface SsrfGuardOptions {
  lookupImpl?: (hostname: string) => Promise<LookupResult>;
}

function v4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inV4Cidr(ip: number, base: number, prefixBits: number): boolean {
  const shift = 32 - prefixBits;
  return ip >>> shift === base >>> shift;
}

// Loopback, RFC1918, link-local (cloud metadata 169.254.169.254 lives here),
// CGNAT, and the reserved/doc/multicast ranges a container or VM answers on.
const V4_BLOCKED: ReadonlyArray<readonly [number, number]> = [
  [v4(0, 0, 0, 0), 8],
  [v4(10, 0, 0, 0), 8],
  [v4(100, 64, 0, 0), 10],
  [v4(127, 0, 0, 0), 8],
  [v4(169, 254, 0, 0), 16],
  [v4(172, 16, 0, 0), 12],
  [v4(192, 0, 0, 0), 24],
  [v4(192, 0, 2, 0), 24],
  [v4(192, 168, 0, 0), 16],
  [v4(198, 18, 0, 0), 15],
  [v4(198, 51, 100, 0), 24],
  [v4(203, 0, 113, 0), 24],
  [v4(224, 0, 0, 0), 4],
  [v4(240, 0, 0, 0), 4],
];

function isBlockedV4(ip: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => inV4Cidr(ip, base, bits));
}

function wordsToBytes(words: number[]): Uint8Array {
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = (word >>> 8) & 0xff;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

export function parseIpv6(ip: string): Uint8Array | null {
  const value = ip.split('%')[0];
  const halves = value.split('::');
  if (halves.length > 2) return null;

  const toWords = (segment: string): number[] | null => {
    if (segment === '') return [];
    const items = segment.split(':');
    const words: number[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (index === items.length - 1 && item.includes('.')) {
        const embedded = parseIpv4(item);
        if (embedded === null) return null;
        words.push(embedded >>> 16, embedded & 0xffff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null;
      words.push(parseInt(item, 16));
    }
    return words;
  };

  const head = toWords(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? wordsToBytes(head) : null;

  const tail = toWords(halves[1]);
  if (!tail) return null;
  const gap = 8 - head.length - tail.length;
  if (gap < 0) return null;
  return wordsToBytes([...head, ...new Array(gap).fill(0), ...tail]);
}

// ::ffff:a.b.c.d, 6to4 2002::/16 and NAT64 64:ff9b::/96 carry an IPv4 that has
// to be judged on its own instead of passing as a public v6 address.
function embeddedV4(bytes: Uint8Array): number | null {
  const high = bytes.subarray(0, 10).every((b) => b === 0);
  if (high && bytes[10] === 0xff && bytes[11] === 0xff) {
    return v4(bytes[12], bytes[13], bytes[14], bytes[15]);
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return v4(bytes[12], bytes[13], bytes[14], bytes[15]);
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return v4(bytes[2], bytes[3], bytes[4], bytes[5]);
  }
  return null;
}

export function isBlockedIpv6(bytes: Uint8Array): boolean {
  if (bytes.every((b) => b === 0)) return true;
  if (bytes.subarray(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
  if (bytes[0] === 0xfc || bytes[0] === 0xfd) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xff) return true;
  const embedded = embeddedV4(bytes);
  return embedded !== null && isBlockedV4(embedded);
}

export function isBlockedIpAddress(ip: string): boolean {
  const literal = parseIpv4(ip);
  if (literal !== null) return isBlockedV4(literal);
  if (ip.includes(':')) {
    const bytes = parseIpv6(ip);
    // Unparseable v6 is refused rather than guessed at.
    return bytes === null || isBlockedIpv6(bytes);
  }
  return false;
}

function normalizeAddresses(result: LookupResult): string[] {
  return result
    .map((entry) => (typeof entry === 'string' ? entry : entry.address))
    .filter((value) => typeof value === 'string' && value !== '');
}

export async function assertSafeWebUrl(raw: string, opts: SsrfGuardOptions = {}): Promise<URL> {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw webError('INVALID_URL', `"${trimmed}" is not an absolute URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw webError(
      'INVALID_URL',
      `Only http and https URLs are supported, got "${url.protocol}".`,
      { metadata: { protocol: url.protocol } },
    );
  }
  if (url.hostname === '') {
    throw webError('INVALID_URL', 'URL has no host.');
  }

  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const isLiteral = parseIpv4(host) !== null || host.includes(':');
  if (isLiteral) {
    if (isBlockedIpAddress(host)) {
      throw webError('SSRF_BLOCKED', `Address ${host} is not reachable from this tool.`, {
        metadata: { host },
      });
    }
    return url;
  }

  const lookupImpl =
    opts.lookupImpl ??
    ((name: string) => lookup(name, { all: true }) as unknown as Promise<LookupResult>);
  let resolved: LookupResult;
  try {
    resolved = await lookupImpl(url.hostname);
  } catch (err) {
    throw webError('OFFLINE', `Could not resolve ${url.hostname}.`, { cause: err });
  }
  const addresses = normalizeAddresses(resolved);
  if (addresses.length === 0) {
    throw webError('OFFLINE', `${url.hostname} resolved to no address.`);
  }
  const blocked = addresses.filter((ip) => isBlockedIpAddress(ip));
  if (blocked.length > 0) {
    throw webError('SSRF_BLOCKED', `${url.hostname} resolves to a private or reserved address.`, {
      metadata: { host: url.hostname, blocked },
    });
  }
  return url;
}
