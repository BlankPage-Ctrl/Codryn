// Single source of truth for the backend version.
//
// Resolution order (highest priority first):
//   1. CODRYN_VERSION env — set by CI from the GitHub Release tag
//      (GITHUB_REF_NAME, e.g. "v1.2.3"). The leading "v" is stripped.
//   2. APP_VERSION env — generic alternative for custom deployments.
//   3. Baked compile-time version (__CODRYN_VERSION__) — injected by
//      `make build-backend VERSION=x.y.z` via `bun build --define`.
//      This is what `codryn --version` reports for release binaries,
//      which have no package.json next to them.
//   4. packages/backend/package.json "version" — local dev and npm runs.
//   5. Dev fallback "0.0.0-dev" with the short commit sha when available
//      (GITHUB_SHA / GIT_SHA), e.g. "0.0.0-dev+abc1234".
//
// The backend binary is spawned without a .git directory in production,
// so the version is resolved from the environment, never via `git describe`
// at runtime.
//
// NOTE: do NOT bake with `--define process.env.CODRYN_VERSION=...`.
// That form hardcodes the value and kills runtime overrides. The dedicated
// __CODRYN_VERSION__ constant keeps `CODRYN_VERSION`/`APP_VERSION` env
// overrides working (env still wins over the baked value).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BACKEND_NAME = 'codryn' as const;

export const DEV_VERSION = '0.0.0-dev' as const;

// Compile-time injected version (see Makefile build-backend).
// `typeof __CODRYN_VERSION__ !== 'undefined'` is safe even when bun
// did not define it (tsx dev, tsc builds, unit tests).
declare const __CODRYN_VERSION__: string | undefined;

function readBakedVersion(): string | null {
  try {
    if (typeof __CODRYN_VERSION__ === 'string') {
      return normalizeTag(__CODRYN_VERSION__);
    }
  } catch {
    // ReferenceError in environments without the define; fall through.
  }
  return null;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface VersionInfo {
  name: typeof BACKEND_NAME;
  version: string;
  sha: string | null;
  tag: string | null;
}

/**
 * Normalize a raw version or release tag into a semver string.
 * Strips one leading "v"/"V" (GitHub Release tags look like "v1.2.3").
 * Returns null when the input is not usable semver.
 */
export function normalizeTag(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const stripped = trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed;
  if (!SEMVER_PATTERN.test(stripped)) return null;
  return stripped;
}

function resolveSha(env: NodeJS.ProcessEnv): string | null {
  const sha = env.GITHUB_SHA ?? env.GIT_SHA;
  if (typeof sha !== 'string' || sha.trim().length === 0) return null;
  return sha.trim().slice(0, 7);
}

let cachedPackageJsonVersion: string | null | undefined;

function readPackageJsonVersion(): string | null {
  if (cachedPackageJsonVersion !== undefined) return cachedPackageJsonVersion;
  cachedPackageJsonVersion = null;
  try {
    const here = new URL(import.meta.url);
    const candidates = [
      // tsx / ts-node dev: packages/backend/apps/shared/ -> packages/backend/
      new URL('../../package.json', here),
      // tsc build: packages/backend/dist/apps/shared/ -> packages/backend/
      new URL('../../../package.json', here),
    ];
    for (const candidate of candidates) {
      try {
        const raw: unknown = JSON.parse(readFileSync(fileURLToPath(candidate), 'utf8'));
        if (isRecord(raw)) {
          if (typeof raw.version === 'string' && normalizeTag(raw.version) !== null) {
            cachedPackageJsonVersion = normalizeTag(raw.version);
            break;
          }
        }
      } catch {
        // Try the next candidate path.
      }
    }
  } catch {
    // Filesystem or URL errors mean no package.json version is available.
  }
  return cachedPackageJsonVersion;
}

/** For tests only: reset the package.json lookup cache. */
export function resetVersionCacheForTest(): void {
  cachedPackageJsonVersion = undefined;
}

export function getVersion(env: NodeJS.ProcessEnv = process.env): string {
  return resolveVersion({
    tag: normalizeTag(env.CODRYN_VERSION) ?? normalizeTag(env.APP_VERSION),
    baked: readBakedVersion(),
    packageJson: readPackageJsonVersion(),
    sha: resolveSha(env),
  });
}

/**
 * Pure version picker. Separated from env/filesystem access so the
 * priority chain is unit-testable without touching process.env.
 */
export function resolveVersion(input: {
  tag: string | null;
  baked?: string | null;
  packageJson: string | null;
  sha: string | null;
}): string {
  if (input.tag !== null) return input.tag;
  if (input.baked !== null && input.baked !== undefined) return input.baked;
  if (input.packageJson !== null) return input.packageJson;
  if (input.sha !== null) return `${DEV_VERSION}+${input.sha}`;
  return DEV_VERSION;
}

export function getVersionInfo(env: NodeJS.ProcessEnv = process.env): VersionInfo {
  const rawTag = env.CODRYN_VERSION ?? env.APP_VERSION ?? null;
  return {
    name: BACKEND_NAME,
    version: getVersion(env),
    sha: resolveSha(env),
    tag: typeof rawTag === 'string' && rawTag.trim().length > 0 ? rawTag.trim() : null,
  };
}
