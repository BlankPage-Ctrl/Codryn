import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INSIGHT_BINARY_ENV,
  INSIGHT_COMPAT_MAX,
  INSIGHT_COMPAT_MIN,
  INSIGHT_DEV_DIR_NAME,
  INSIGHT_PROD_DIR_PARTS,
  INSIGHT_VERSION_TIMEOUT_MS,
} from './constants.js';
import { InsightBinaryError, InsightIncompatibleError } from './execute/errors.js';
import type { InsightLogger } from './types.js';

export type InsightBinarySource = 'override' | 'env' | 'prod' | 'dev' | 'path';

export interface InsightBinaryFound {
  path: string;
  source: InsightBinarySource;
  dir?: string;
}

export interface InsightBinaryVersion {
  raw: string;
  /** Without `v` prefix, e.g. `0.0.10`. */
  version: string;
  commit?: string;
  builtAt?: string;
}

export interface InsightBinaryInfo extends InsightBinaryFound {
  /** Null when the `version` probe failed. */
  version: string | null;
  compatible: boolean;
  /** Set when probing failed or the version is outside the supported range (warn-only, still runs). */
  warning?: string;
}

type Semver = [number, number, number];

export function parseSemver(v: string): Semver | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa) throw new InsightBinaryError(`insight: invalid semver "${a}"`);
  if (!pb) throw new InsightBinaryError(`insight: invalid semver "${b}"`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isInsightVersionCompatible(
  version: string,
  min: string | undefined = INSIGHT_COMPAT_MIN,
  max: string | undefined = INSIGHT_COMPAT_MAX,
): boolean {
  if (!parseSemver(version)) return false;
  if (min) {
    if (!parseSemver(min)) throw new InsightBinaryError(`insight: invalid compat min "${min}"`);
    if (compareSemver(version, min) < 0) return false;
  }
  if (max) {
    if (!parseSemver(max)) throw new InsightBinaryError(`insight: invalid compat max "${max}"`);
    if (compareSemver(version, max) > 0) return false;
  }
  return true;
}

function norm(v: string): string {
  return v.trim().replace(/^v/, '');
}

export function describeInsightCompat(
  min: string | undefined = INSIGHT_COMPAT_MIN,
  max: string | undefined = INSIGHT_COMPAT_MAX,
): string {
  if (min && max) {
    return norm(min) === norm(max) ? `only v${norm(max)}` : `from v${norm(min)} to v${norm(max)}`;
  }
  if (min) return `>= v${norm(min)}`;
  if (max) return `<= v${norm(max)}`;
  return 'any version';
}

/**
 * Parse `<binary> version` output, e.g.
 * `srcinsight v0.0.10 (commit b2f638e, built 2026-09-27T11:51:35Z)`.
 */
export function parseInsightVersionOutput(text: string): InsightBinaryVersion | null {
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return null;
  const vm = first.match(/v?(\d+\.\d+\.\d+)/);
  if (!vm) return null;
  const commit = first.match(/commit\s+([0-9a-f]{4,40})/i)?.[1];
  const builtAt = first.match(/built\s+([^\s,)\]]+)/i)?.[1];
  return {
    raw: first,
    version: vm[1],
    ...(commit ? { commit } : {}),
    ...(builtAt ? { builtAt } : {}),
  };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function safeHomedir(): string {
  try {
    return homedir() ?? '';
  } catch {
    return '';
  }
}

export function prodInsightDir(home: string = safeHomedir()): string {
  return join(home, ...INSIGHT_PROD_DIR_PARTS);
}

/** Dev dirs to search, robust against cwd and compiled `dist/` layouts. */
export function candidateDevDirs(opts: { cwd?: string; here?: string } = {}): string[] {
  const here = opts.here ?? dirname(fileURLToPath(import.meta.url));
  const starts = [here, opts.cwd ?? process.cwd()];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (d: string) => {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  };
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 12; i++) {
      push(join(dir, 'packages', 'backend', INSIGHT_DEV_DIR_NAME));
      if (basename(dir).toLowerCase() === 'backend') {
        push(join(dir, INSIGHT_DEV_DIR_NAME));
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return out;
}

export function searchedInsightDirs(
  opts: { homeDir?: string; cwd?: string; here?: string } = {},
): string[] {
  const out: string[] = [];
  const home = opts.homeDir ?? safeHomedir();
  if (home) out.push(prodInsightDir(home));
  out.push(...candidateDevDirs({ cwd: opts.cwd, here: opts.here }));
  return out;
}

/** Negative = skip this file. Higher = more preferred. */
function platformScore(lowerFile: string, isExe: boolean, plat: NodeJS.Platform): number {
  if (plat === 'win32') {
    // Extensionless files cannot be spawned on Windows (no PATHEXT match).
    if (!isExe) return -1;
    if (lowerFile.includes('windows')) return 4;
    return 3;
  }
  if (isExe) return -1;
  if (plat === 'linux') {
    if (lowerFile.includes('linux')) return 3;
    if (
      lowerFile.includes('windows') ||
      lowerFile.includes('darwin') ||
      lowerFile.includes('macos')
    )
      return -1;
    return 2;
  }
  if (plat === 'darwin') {
    if (lowerFile.includes('darwin') || lowerFile.includes('macos')) return 3;
    if (lowerFile.includes('windows') || lowerFile.includes('linux')) return -1;
    return 2;
  }
  if (lowerFile.includes('windows')) return -1;
  return 2;
}

function cmpTuple(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function pickBinaryInDir(dir: string, plat: NodeJS.Platform = osPlatform()): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const cands: { file: string; score: number; ver: Semver }[] = [];
  for (const f of entries) {
    // Strip .exe first: the version-suffix class allows dots and would
    // otherwise swallow the extension (e.g. `srcinsight-v0.0.10-windows-amd64.exe`).
    const lower = f.toLowerCase();
    const isExe = lower.endsWith('.exe');
    const core = isExe ? f.slice(0, -4) : f;
    const m = core.match(/^srcinsight(?:-v?(\d+\.\d+\.\d+)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?)?$/);
    if (!m) continue;
    const full = join(dir, f);
    if (!isFile(full)) continue;
    const score = platformScore(lower, isExe, plat);
    if (score < 0) continue;
    cands.push({ file: full, score, ver: m[1] ? (parseSemver(m[1]) ?? [0, 0, 0]) : [0, 0, 0] });
  }
  cands.sort((a, b) => b.score - a.score || cmpTuple(b.ver, a.ver));
  return cands[0]?.file ?? null;
}

function findOnPath(plat: NodeJS.Platform): string | null {
  const rawPath = process.env.PATH;
  if (!rawPath) return null;
  const names =
    plat === 'win32' ? ['srcinsight.exe', 'srcinsight.cmd', 'srcinsight.bat'] : ['srcinsight'];
  try {
    for (const dir of rawPath.split(delimiter)) {
      if (!dir) continue;
      for (const name of names) {
        const full = join(dir, name);
        if (isFile(full)) return full;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface FindInsightBinaryOpts {
  override?: string;
  envBinary?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  cwd?: string;
  here?: string;
}

/**
 * Locate a runnable srcinsight binary.
 * Order: explicit override > `$INSIGHT_BINARY` > prod (`~/codryn/backend/bin/insight/`)
 * > dev (`packages/backend/srcinsight/`) > PATH.
 * Explicit paths are returned as-is when they exist, and throw InsightBinaryError when missing.
 */
export function findInsightBinary(opts: FindInsightBinaryOpts = {}): InsightBinaryFound | null {
  const plat = opts.platform ?? osPlatform();
  if (opts.override) {
    if (!isFile(opts.override)) {
      throw new InsightBinaryError(
        `insight binary not found: ${opts.override} (explicit binaryPath override)`,
      );
    }
    return { path: opts.override, source: 'override' };
  }
  const env = opts.envBinary ?? process.env[INSIGHT_BINARY_ENV];
  if (env) {
    if (!isFile(env)) {
      throw new InsightBinaryError(`insight binary not found: ${env} (from ${INSIGHT_BINARY_ENV})`);
    }
    return { path: env, source: 'env' };
  }
  const home = opts.homeDir ?? safeHomedir();
  if (home) {
    const dir = prodInsightDir(home);
    const hit = pickBinaryInDir(dir, plat);
    if (hit) return { path: hit, source: 'prod', dir };
  }
  for (const dir of candidateDevDirs({ cwd: opts.cwd, here: opts.here })) {
    const hit = pickBinaryInDir(dir, plat);
    if (hit) return { path: hit, source: 'dev', dir };
  }
  const onPath = findOnPath(plat);
  if (onPath) return { path: onPath, source: 'path' };
  return null;
}

export type InsightVersionRunner = (bin: string) => Promise<string>;

function defaultRunner(bin: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(bin, ['version'], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolvePromise(`${stdout ?? ''}\n${stderr ?? ''}`);
    });
  });
}

export async function probeInsightBinaryVersion(
  bin: string,
  opts: { timeoutMs?: number; run?: InsightVersionRunner } = {},
): Promise<InsightBinaryVersion | null> {
  try {
    const out = opts.run
      ? await opts.run(bin)
      : await defaultRunner(bin, opts.timeoutMs ?? INSIGHT_VERSION_TIMEOUT_MS);
    return parseInsightVersionOutput(out);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new InsightBinaryError(
        `insight binary not executable: ${bin} (Permission denied). Run: chmod +x "${bin}"`,
        err,
      );
    }
    return null;
  }
}

const probeCache = new Map<string, InsightBinaryVersion | null>();

export function clearInsightBinaryCacheForTest(): void {
  probeCache.clear();
}

export interface EnsureInsightBinaryOpts {
  binaryPath?: string;
  envBinary?: string;
  logger?: InsightLogger;
  timeoutMs?: number;
  run?: InsightVersionRunner;
  findOpts?: Omit<FindInsightBinaryOpts, 'override' | 'envBinary'>;
}

/**
 * Resolve + version-check the binary. Fail-fast policy for missing or
 * non-executable binaries (throws); version mismatch or unparseable probe
 * output only warns and still runs.
 */
export async function ensureInsightBinary(
  opts: EnsureInsightBinaryOpts = {},
): Promise<InsightBinaryInfo> {
  const found = findInsightBinary({
    override: opts.binaryPath,
    envBinary: opts.envBinary,
    ...(opts.findOpts ?? {}),
  });
  if (!found) {
    const tried = searchedInsightDirs(opts.findOpts ?? {});
    throw new InsightBinaryError(
      `insight binary not found. Set ${INSIGHT_BINARY_ENV} to a srcinsight binary or place one in: ${tried.join(', ') || '(no candidate dirs)'}`,
    );
  }
  // Fail fast when the file cannot be executed (e.g. missing +x after
  // checkout). Previously this fell through to a "version unknown" warning
  // and a standby daemon that could never start.
  if (osPlatform() !== 'win32' && !isExecutable(found.path)) {
    throw new InsightBinaryError(
      `insight binary not executable: ${found.path} (Permission denied). Run: chmod +x "${found.path}"`,
    );
  }
  // Do not trust a cached null probe: the file may have been chmodded since.
  let probed = probeCache.get(found.path);
  if (probed === undefined || probed === null) {
    probed = await probeInsightBinaryVersion(found.path, {
      timeoutMs: opts.timeoutMs,
      run: opts.run,
    });
    probeCache.set(found.path, probed);
  }
  const expected = describeInsightCompat();
  if (!probed) {
    const warning = `insight binary version unknown (${found.path}); expected ${expected}, continuing anyway`;
    opts.logger?.warn?.({ binary: found.path }, warning);
    return { ...found, version: null, compatible: true, warning };
  }
  if (!isInsightVersionCompatible(probed.version)) {
    const err = new InsightIncompatibleError(found.path, probed.version, expected);
    opts.logger?.warn?.({ binary: found.path, version: probed.version }, err.message);
    return { ...found, version: probed.version, compatible: false, warning: err.message };
  }
  opts.logger?.debug?.(
    { binary: found.path, version: probed.version },
    'insight binary version ok',
  );
  return { ...found, version: probed.version, compatible: true };
}
