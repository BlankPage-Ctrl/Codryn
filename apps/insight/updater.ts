import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  INSIGHT_COMPAT_MIN,
  INSIGHT_DOWNLOAD_TIMEOUT_MS,
  INSIGHT_VERSION_TIMEOUT_MS,
} from './constants.js';
import {
  compareSemver,
  parseSemver,
  probeInsightBinaryVersion,
  prodInsightDir,
  type InsightVersionRunner,
} from './binary.js';
import { InsightBinaryError } from './execute/errors.js';
import type { InsightLogger } from './types.js';

export const INSIGHT_RELEASE_REPO = 'BlankPage-Ctrl/SrcInsight';
export const INSIGHT_RELEASE_API = `https://api.github.com/repos/${INSIGHT_RELEASE_REPO}`;

/** Release tag convention (see Makefile INSIGHT_TAG): `v.` + version. */
export function insightReleaseTag(version: string): string {
  return `v.${version}`;
}

export interface InsightAssetTarget {
  os: string;
  arch: string;
  ext: string;
}

// Map the current runtime to a SrcInsight release asset suffix.
export function insightAssetTarget(
  plat: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): InsightAssetTarget {
  const normalizedArch = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!normalizedArch) {
    throw new InsightBinaryError(`insight update not supported on arch "${arch}"`);
  }
  if (plat === 'win32') return { os: 'windows', arch: normalizedArch, ext: '.exe' };
  if (plat === 'linux') return { os: 'linux', arch: normalizedArch, ext: '' };
  if (plat === 'darwin') return { os: 'darwin', arch: normalizedArch, ext: '' };
  throw new InsightBinaryError(`insight update not supported on platform "${plat}"`);
}

export function insightAssetName(
  version: string,
  target: InsightAssetTarget = insightAssetTarget(),
): string {
  return `srcinsight-v${version}-${target.os}-${target.arch}${target.ext}`;
}

export function insightDownloadUrl(
  version: string,
  target: InsightAssetTarget = insightAssetTarget(),
): string {
  const tag = insightReleaseTag(version);
  return `https://github.com/${INSIGHT_RELEASE_REPO}/releases/download/${tag}/${insightAssetName(version, target)}`;
}

export interface DownloadInsightBinaryOpts {
  version: string;
  dir?: string;
  logger?: InsightLogger;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  versionRunner?: InsightVersionRunner;
  target?: InsightAssetTarget;
}

export interface DownloadedInsightBinary {
  path: string;
  version: string;
  url: string;
}

function defaultVersionRunner(bin: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(
      bin,
      ['version'],
      { timeout: INSIGHT_VERSION_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePromise(`${stdout ?? ''}\n${stderr ?? ''}`);
      },
    );
  });
}

export interface InsightReleaseDigest {
  sha256: string;
  size: number;
  assetUrl: string;
}

export interface FetchInsightReleaseDigestOpts {
  target?: InsightAssetTarget;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  logger?: InsightLogger;
}

interface ReleaseAssetJson {
  name?: unknown;
  digest?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
}

function githubToken(env: NodeJS.ProcessEnv | undefined): string | null {
  const raw = (env ?? process.env).GITHUB_TOKEN;
  const token = typeof raw === 'string' ? raw.trim() : '';
  return token ? token : null;
}

/**
 * Read the expected SHA256 for a release asset from the GitHub Releases API
 * (`digest: "sha256:<hex>"` per asset).
 */
export async function fetchInsightReleaseDigest(
  version: string,
  opts: FetchInsightReleaseDigestOpts = {},
): Promise<InsightReleaseDigest> {
  const clean = version.trim().replace(/^v/, '');
  if (!parseSemver(clean)) {
    throw new InsightBinaryError(`insight update: invalid version "${version}"`);
  }
  const target = opts.target ?? insightAssetTarget();
  const fileName = insightAssetName(clean, target);
  const url = `${INSIGHT_RELEASE_API}/releases/tags/${encodeURIComponent(insightReleaseTag(clean))}`;
  const token = githubToken(opts.env);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(INSIGHT_VERSION_TIMEOUT_MS),
    });
  } catch (err) {
    throw new InsightBinaryError(
      `insight release metadata fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' (possible GitHub API rate limit; set GITHUB_TOKEN to raise the quota)'
        : '';
    throw new InsightBinaryError(
      `insight release metadata fetch failed: HTTP ${res.status} for ${url}${hint}`,
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new InsightBinaryError(
      `insight release metadata is not valid JSON for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const assets = (body as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) {
    throw new InsightBinaryError(`insight release metadata has no assets list for ${url}`);
  }
  const match = assets.find((a) => (a as ReleaseAssetJson).name === fileName) as
    | ReleaseAssetJson
    | undefined;
  if (!match) {
    throw new InsightBinaryError(
      `insight release ${insightReleaseTag(clean)} has no asset named ${fileName}`,
    );
  }
  const digestRaw = typeof match.digest === 'string' ? match.digest : '';
  const digestMatch = digestRaw.match(/^sha256:([0-9a-fA-F]{64})$/);
  if (!digestMatch) {
    throw new InsightBinaryError(
      `insight release asset ${fileName} has no usable sha256 digest (got "${digestRaw || 'none'}")`,
    );
  }
  const size = typeof match.size === 'number' && Number.isFinite(match.size) ? match.size : 0;
  const assetUrl =
    typeof match.browser_download_url === 'string' && match.browser_download_url
      ? match.browser_download_url
      : insightDownloadUrl(clean, target);
  opts.logger?.debug?.(
    { version: clean, sha256: digestMatch[1].toLowerCase() },
    'insight digest ok',
  );
  return { sha256: digestMatch[1].toLowerCase(), size, assetUrl };
}

// Download a SrcInsight release asset into `dir` and verify it twice
export async function downloadInsightBinary(
  opts: DownloadInsightBinaryOpts,
): Promise<DownloadedInsightBinary> {
  const version = opts.version.trim().replace(/^v/, '');
  if (!parseSemver(version)) {
    throw new InsightBinaryError(`insight update: invalid version "${opts.version}"`);
  }
  if (compareSemver(version, INSIGHT_COMPAT_MIN) < 0) {
    throw new InsightBinaryError(
      `insight update refused: v${version} is below the minimum v${INSIGHT_COMPAT_MIN}`,
    );
  }
  const target = opts.target ?? insightAssetTarget();
  const url = insightDownloadUrl(version, target);
  const dir = opts.dir ?? prodInsightDir();
  const fileName = insightAssetName(version, target);

  const digest = await fetchInsightReleaseDigest(version, {
    target,
    fetchImpl: opts.fetchImpl,
    env: opts.env,
    logger: opts.logger,
  });

  await fs.mkdir(dir, { recursive: true });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(INSIGHT_DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new InsightBinaryError(`insight update download failed: HTTP ${res.status} for ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new InsightBinaryError(`insight update download failed: empty body for ${url}`);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== digest.sha256) {
    throw new InsightBinaryError(
      `insight update checksum mismatch for ${url}: expected sha256 ${digest.sha256}, got ${actual}. Refusing to install.`,
    );
  }

  const tmpPath = path.join(dir, `.${fileName}.tmp-${process.pid}`);
  await fs.writeFile(tmpPath, bytes, { mode: 0o755 });
  try {
    if (process.platform !== 'win32') await fs.chmod(tmpPath, 0o755);
    const probed = await probeInsightBinaryVersion(tmpPath, {
      timeoutMs: INSIGHT_VERSION_TIMEOUT_MS,
      run: opts.versionRunner ?? defaultVersionRunner,
    });
    if (!probed || compareSemver(probed.version, version) !== 0) {
      throw new InsightBinaryError(
        `insight update verify failed: downloaded binary reports v${probed?.version ?? 'unknown'}, expected v${version}`,
      );
    }
    const finalPath = path.join(dir, fileName);
    await fs.rename(tmpPath, finalPath);
    opts.logger?.info?.({ path: finalPath, version }, 'insight binary updated');
    return { path: finalPath, version, url };
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
