import { z } from 'zod';
import { CODRYN_ISSUES_URL, INSIGHT_VERSION_TIMEOUT_MS } from './constants.js';
import { InsightBinaryError, InsightUnregisteredVersionError } from './execute/errors.js';

export const INSIGHT_MANIFEST_ENV = 'CODRYN_INSIGHT_MANIFEST_URL';
export const INSIGHT_MANIFEST_REMOTE_URL =
  'https://raw.githubusercontent.com/BlankPage-Ctrl/Codryn/master/apps/insight/manifest.json';

const SemverString = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, 'must be a semver string');

export const InsightManifestPinSchema = z
  .object({
    latest: SemverString,
    supported: z.array(SemverString).min(1),
  })
  .strict()
  .refine((pin) => pin.supported.includes(pin.latest), {
    message: 'latest must be one of supported',
  });

export const InsightManifestSchema = z
  .object({
    manifestVersion: z.number().int().min(1),
    updatedAt: z.string().min(1),
    pins: z.record(z.string(), InsightManifestPinSchema),
    $comment: z.string().optional(),
  })
  .strict();

export type InsightManifestPin = z.infer<typeof InsightManifestPinSchema>;
export type InsightManifest = z.infer<typeof InsightManifestSchema>;

export async function fetchRemoteInsightManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InsightManifest> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(INSIGHT_VERSION_TIMEOUT_MS) });
  } catch (err) {
    throw new InsightBinaryError(
      `insight manifest fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new InsightBinaryError(`insight manifest fetch failed: HTTP ${res.status} for ${url}`);
  }
  const raw: unknown = await res.json();
  return InsightManifestSchema.parse(raw);
}

export interface LoadInsightManifestOpts {
  remoteUrl?: string; // Use CODRYN_INSIGHT_MANIFEST_URL to overwrite it.
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function resolveManifestUrl(opts: LoadInsightManifestOpts): string {
  const fromOpt = opts.remoteUrl?.trim();
  if (fromOpt) return fromOpt;
  const env = opts.env ?? process.env;
  const fromEnv =
    typeof env[INSIGHT_MANIFEST_ENV] === 'string' ? env[INSIGHT_MANIFEST_ENV].trim() : '';
  if (fromEnv) return fromEnv;
  return INSIGHT_MANIFEST_REMOTE_URL;
}

export async function loadInsightManifest(
  opts: LoadInsightManifestOpts = {},
): Promise<InsightManifest> {
  return fetchRemoteInsightManifest(resolveManifestUrl(opts), opts.fetchImpl);
}

function normalizeCodrynVersion(v: string): string {
  // Drop build metadata (`0.0.0-dev+abc1234` -> `0.0.0-dev`) for pin lookup.
  return v.trim().split('+')[0];
}

export interface ResolvedInsightPin {
  pin: InsightManifestPin;
  codrynVersion: string;
}

export function resolveInsightPin(
  manifest: InsightManifest,
  codrynVersion: string,
): InsightManifestPin {
  const normalized = normalizeCodrynVersion(codrynVersion);
  const pin = manifest.pins[normalized];
  if (!pin) {
    throw new InsightUnregisteredVersionError(normalized, CODRYN_ISSUES_URL);
  }
  return pin;
}

export type ResolveInsightPinForUpdateOpts = LoadInsightManifestOpts & {
  codrynVersion: string;
};

export async function resolveInsightPinForUpdate(
  opts: ResolveInsightPinForUpdateOpts,
): Promise<ResolvedInsightPin> {
  const normalized = normalizeCodrynVersion(opts.codrynVersion);
  const manifest = await loadInsightManifest(opts);
  const pin = manifest.pins[normalized];
  if (!pin) {
    throw new InsightUnregisteredVersionError(normalized, CODRYN_ISSUES_URL);
  }
  return { pin, codrynVersion: normalized };
}
