import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const CODRYN_DIR_NAME = '.codryn';
export const BACKEND_DIR_NAME = 'backend';
export interface CodrynHomeOpts {
  home?: string;
}

export interface BasePathOpts extends CodrynHomeOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const RELEASE_BUILD: boolean = process.env.CODRYN_RELEASE_BUILD === '1';

export function isDevMode(opts: { env?: Record<string, string | undefined> } = {}): boolean {
  const env = opts.env ?? process.env;
  const mode = env.APP_ENV ?? env.APP_MODE;

  if (mode !== undefined) {
    return mode === 'development' || mode === 'dev' || mode === 'local';
  }

  if (RELEASE_BUILD) return false;

  return env.NODE_ENV !== 'production';
}

export function resolveCodrynHome(opts: CodrynHomeOpts = {}): string {
  return join(opts.home ?? homedir(), CODRYN_DIR_NAME);
}

// Backend base: `~/.codryn/backend`
export function resolveBackendBasePath(opts: CodrynHomeOpts = {}): string {
  return join(resolveCodrynHome(opts), BACKEND_DIR_NAME);
}

/**
 * Where `config.toml`, `data.db`, `attachments/` and `logs/` live.
 * Dev mode: cwd (project root), so dev stays local like before.
 * Production: always `~/.codryn/backend` on every OS.
 * Release binaries always resolve production (baked marker), unless an
 * explicit dev env (APP_ENV/APP_MODE) or --data-dir says otherwise.
 * Callers that need isolation (tests, scripts, desktop spawn) pass an
 * explicit base path down the call chain instead of env vars.
 */
export function resolveConfigBasePath(opts: BasePathOpts = {}): string {
  const env = opts.env ?? process.env;
  if (isDevMode({ env })) return opts.cwd ?? process.cwd();
  return resolveBackendBasePath({ home: opts.home });
}

export function resolveDatabasePath(raw: string, basePath: string): string {
  if (raw === ':memory:') return raw;
  if (raw.includes('://')) {
    throw new Error(
      `Remote database URLs are not supported (got "${raw}"). Use a local file path or ":memory:".`,
    );
  }

  // Tolerate a stale `file:` prefix from old configs; the driver wants a plain path.
  const rest = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;

  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(rest);

  if (isAbsolute(rest) || isWindowsAbsolute) return rest;

  return join(basePath, rest);
}
