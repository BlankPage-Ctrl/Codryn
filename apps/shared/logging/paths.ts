import { join } from 'node:path';
import { resolveConfigBasePath } from '../../../src/config/utils/path-resolver.js';

export const DEFAULT_MAX_SIZE_MB = 10;
export const DEFAULT_MAX_FILES = 14;

export function resolveLogDir(basePath?: string): string {
  const base = basePath ?? resolveConfigBasePath();
  return join(base, 'logs');
}

export function resolveLogPaths(basePath?: string): { dir: string; jsonl: string; human: string } {
  const dir = resolveLogDir(basePath);
  return {
    dir,
    jsonl: join(dir, 'app.jsonl'),
    human: join(dir, 'app.log'),
  };
}
