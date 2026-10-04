import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  GrepSearchInput,
  GrepSearchResult,
  IGrepStorage,
  RawGrepMatch,
} from '../../types/grep.js';
import { PathNotFoundError } from '../../errors/not-found.js';
import { StorageReadError } from '../../errors/storage.js';
import { InvalidInputError } from '../../errors/validation.js';

/**
 * Cold storage adapter over the `rg` binary bundled by `@vscode/ripgrep`.
 *
 * One job: spawn `rg --json`, stream-match lines, return raw data.
 * No Zod here - validation happens in `repository/grep.ts`.
 * The process `cwd` is the workspace root and every search path is
 * `cwd`-relative, so globs and `.gitignore` discovery behave like gitignore.
 */
export class GrepStorage implements IGrepStorage {
  async search(input: GrepSearchInput): Promise<GrepSearchResult> {
    return runRg(input.cwd, buildArgs(input), input);
  }
}

/** Env var pointing `rg` resolution at an explicit binary. */
export const RG_BINARY_ENV = 'CODRYN_RG_PATH';

/**
 * Prod bundle layout (all OSes): `~/codryn/backend/bin/rg/`.
 * Mirrors insight's `~/codryn/backend/bin/insight/`.
 */
export const RG_PROD_DIR_PARTS = ['codryn', 'backend', 'bin', 'rg'] as const;

function safeHomedir(): string {
  try {
    return homedir() ?? '';
  } catch {
    return '';
  }
}

export function prodRgDir(home: string = safeHomedir()): string {
  return join(home, ...RG_PROD_DIR_PARTS);
}

function rgExpectedName(plat: NodeJS.Platform): string {
  return plat === 'win32'
    ? 'rg-v<semver>-<triple>.exe (e.g. rg-v13.0.0-x86_64-pc-windows-msvc.exe)'
    : 'rg-v<semver>-<triple> (e.g. rg-v13.0.0-x86_64-unknown-linux-musl)';
}

type RgSemver = [number, number, number];

function parseRgSemver(v: string): RgSemver | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpRgSemver(a: RgSemver, b: RgSemver): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Negative = skip this file. Higher = more preferred. */
function rgPlatformScore(lowerFile: string, isExe: boolean, plat: NodeJS.Platform): number {
  if (plat === 'win32') {
    // Extensionless files cannot be spawned on Windows (no PATHEXT match).
    if (!isExe) return -1;
    if (lowerFile.includes('windows') || lowerFile.includes('msvc')) return 4;
    if (lowerFile.includes('linux') || lowerFile.includes('darwin') || lowerFile.includes('macos'))
      return -1;
    return 3;
  }
  if (isExe) return -1;
  if (plat === 'linux') {
    if (lowerFile.includes('linux')) return 3;
    if (
      lowerFile.includes('windows') ||
      lowerFile.includes('msvc') ||
      lowerFile.includes('darwin') ||
      lowerFile.includes('macos')
    )
      return -1;
    return 2;
  }
  if (plat === 'darwin') {
    if (lowerFile.includes('darwin') || lowerFile.includes('macos') || lowerFile.includes('apple'))
      return 3;
    if (lowerFile.includes('windows') || lowerFile.includes('msvc') || lowerFile.includes('linux'))
      return -1;
    return 2;
  }
  if (lowerFile.includes('windows') || lowerFile.includes('msvc')) return -1;
  return 2;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Versioned lookup inside a prod dir: `rg-v<semver>-<triple>` (posix) or
 * `rg-v<semver>-<triple>.exe` (windows). Picks the highest version when
 * several triples or versions are present. Plain `rg` is ignored by design
 * so the version always stays explicit in the file name.
 */
export function findRgInDir(dir: string, plat: NodeJS.Platform = process.platform): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const cands: { file: string; score: number; ver: RgSemver }[] = [];
  for (const f of entries) {
    const lower = f.toLowerCase();
    const isExe = lower.endsWith('.exe');
    const core = isExe ? f.slice(0, -4) : f;
    const m = core.match(/^rg-v?(\d+\.\d+\.\d+)-([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (!m) continue;
    const ver = parseRgSemver(m[1]);
    if (!ver) continue;
    const full = join(dir, f);
    if (!isFile(full)) continue;
    const score = rgPlatformScore(lower, isExe, plat);
    if (score < 0) continue;
    cands.push({ file: full, score, ver });
  }
  cands.sort((a, b) => b.score - a.score || cmpRgSemver(b.ver, a.ver));
  return cands[0]?.file ?? null;
}

export interface ResolveRgPathOpts {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export function resolveRgPath(opts: ResolveRgPathOpts = {}): string {
  const env = opts.env ?? process.env;
  const override = env[RG_BINARY_ENV]?.trim();
  if (override) {
    if (!isFile(override)) {
      throw new Error(`ripgrep binary not found: ${override} (from ${RG_BINARY_ENV})`);
    }
    return override;
  }
  const plat = opts.platform ?? process.platform;
  const home = opts.homeDir ?? safeHomedir();
  if (home) {
    const hit = findRgInDir(prodRgDir(home), plat);
    if (hit) return hit;
  }
  try {
    const require = createRequire(import.meta.url);
    const mod = require('@vscode/ripgrep') as { rgPath?: unknown };
    if (typeof mod.rgPath === 'string' && mod.rgPath !== '') return mod.rgPath;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'ripgrep binary not found. Install the "@vscode/ripgrep" platform package ' +
      `for this OS/arch, place "${rgExpectedName(plat)}" in ${join('~', ...RG_PROD_DIR_PARTS)} ` +
      `or set ${RG_BINARY_ENV} to an rg binary.`,
  );
}

/** Hard cap on buffered stdout so one minified file cannot OOM the host. */
const STDOUT_BYTE_CAP = 16 * 1024 * 1024;

function buildArgs(input: GrepSearchInput): string[] {
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--no-heading',
    // Honor .gitignore/.ignore even when the workspace is not a git repo.
    '--no-require-git',
  ];
  args.push(input.caseInsensitive ? '--ignore-case' : '--case-sensitive');
  if (input.fixedStrings) args.push('--fixed-strings');
  if (!input.respectIgnoreFiles) args.push('--no-ignore', '--hidden');
  for (const glob of input.globs) {
    args.push('--glob', glob);
  }
  for (const pattern of input.ignoreGlobs) {
    for (const translated of toIgnoreGlobs(pattern)) {
      args.push('--glob', translated);
    }
  }
  if (input.maxFileSize !== undefined) {
    args.push('--max-filesize', input.maxFileSize);
  }
  args.push('--', input.pattern, ...input.paths);
  return args;
}

/**
 * Best-effort translation of a gitignore-syntax pattern to `rg --glob`
 * exclusions. `rg` globs match `cwd`-relative paths, so a bare name must be
 * expanded to any-depth forms to mirror `ignore`-package semantics.
 */
function toIgnoreGlobs(pattern: string): string[] {
  const trimmed = pattern.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '!') return [];
  const negated = trimmed.startsWith('!');
  const body = negated ? trimmed.slice(1) : trimmed;
  const unrooted = body.startsWith('/') ? body.slice(1) : body;
  const deny = negated ? '' : '!';
  if (unrooted.includes('/') || unrooted.includes('*')) {
    return [`${deny}${unrooted}`, `${deny}${unrooted}/**`];
  }
  return [`${deny}**/${unrooted}`, `${deny}**/${unrooted}/**`];
}

function runRg(cwd: string, args: string[], input: GrepSearchInput): Promise<GrepSearchResult> {
  return new Promise((resolve, reject) => {
    const matches: RawGrepMatch[] = [];
    let truncated = false;
    let settled = false;
    let remainder = '';
    let stdoutBytes = 0;
    let stderr = '';

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolveRgPath(), args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(
        new StorageReadError('ripgrep failed to start', {
          cwd,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(new StorageReadError(`ripgrep timed out after ${input.timeoutMs}ms`, { cwd }));
      });
    }, input.timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_BYTE_CAP) {
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      remainder += chunk.toString('utf8');
      const lines = remainder.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') continue;
        const parsed = parseMatchLine(line);
        if (parsed instanceof Error) {
          const failure = parsed;
          finish(() => {
            child.kill('SIGKILL');
            reject(failure);
          });
          return;
        }
        if (parsed !== undefined) {
          matches.push(parsed);
          if (matches.length >= input.maxResults) {
            truncated = true;
            child.kill('SIGKILL');
            return;
          }
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: Error) => {
      finish(() => {
        reject(
          new StorageReadError(`ripgrep failed to run: ${error.message}`, {
            cwd,
          }),
        );
      });
    });

    child.on('close', (code: number | null) => {
      finish(() => {
        // Killed by us after hitting maxResults / byte cap: keep what we have.
        if (truncated) {
          resolve({ matches, truncated: true });
          return;
        }
        // rg exit 0 = matches, 1 = no matches. Both are successful runs.
        if (code === 0 || code === 1) {
          if (remainder !== '') {
            const tail = parseMatchLine(remainder);
            if (tail instanceof Error) {
              reject(tail);
              return;
            }
            if (tail !== undefined && matches.length < input.maxResults) {
              matches.push(tail);
            }
          }
          resolve({ matches, truncated: false });
          return;
        }
        reject(classifyRgError(code, stderr, input));
      });
    });
  });
}

function classifyRgError(code: number | null, stderr: string, input: GrepSearchInput): Error {
  const clean = stderr.trim().slice(0, 500);
  if (/regex parse error|error parsing regex|unclosed/i.test(clean)) {
    return new InvalidInputError(`Invalid grep pattern: ${clean}`);
  }
  if (/no such file or directory/i.test(clean)) {
    return new PathNotFoundError(input.paths.join(', ') || '.', {
      stderr: clean,
    });
  }
  return new StorageReadError(
    `ripgrep exited with code ${code ?? 'signal'}: ${clean || 'unknown error'}`,
    { cwd: input.cwd },
  );
}

function stripTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Returns `undefined` for non-match protocol lines (`begin`/`end`/`summary`
 * are part of the protocol and intentionally skipped), the parsed match for
 * `match` lines, or an `Error` when the stream is corrupt - corruption must
 * propagate, never be silently skipped.
 */
function parseMatchLine(line: string): RawGrepMatch | undefined | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return new StorageReadError('ripgrep emitted invalid JSON', {
      line: line.slice(0, 200),
    });
  }
  if (!isRecord(parsed) || parsed.type !== 'match' || !isRecord(parsed.data)) {
    return undefined;
  }
  const data = parsed.data;
  const pathText =
    isRecord(data.path) && typeof data.path.text === 'string' ? data.path.text : undefined;
  const lineNumber = typeof data.line_number === 'number' ? data.line_number : undefined;
  const linesText =
    isRecord(data.lines) && typeof data.lines.text === 'string' ? data.lines.text : undefined;
  const submatches = Array.isArray(data.submatches) ? data.submatches : [];
  const first = submatches.length > 0 ? submatches[0] : undefined;
  const start = isRecord(first) && typeof first.start === 'number' ? first.start : undefined;
  if (
    pathText === undefined ||
    lineNumber === undefined ||
    linesText === undefined ||
    start === undefined
  ) {
    return new StorageReadError('ripgrep match had an unexpected shape', {
      line: line.slice(0, 200),
    });
  }
  return {
    path: pathText,
    line: lineNumber,
    column: start + 1,
    text: stripTrailingNewline(linesText),
  };
}
