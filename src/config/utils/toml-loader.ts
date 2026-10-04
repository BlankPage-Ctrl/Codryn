import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'smol-toml';

export interface TomlLoadOptions {
  basePath?: string;
}

export function loadToml(path: string, options?: TomlLoadOptions): Record<string, unknown> {
  const fullPath = join(options?.basePath ?? process.cwd(), path);
  const content = readFileSync(fullPath, 'utf-8');
  return parse(content) as Record<string, unknown>;
}

export function writeToml(
  path: string,
  data: Record<string, unknown>,
  options?: TomlLoadOptions,
): void {
  const fullPath = join(options?.basePath ?? process.cwd(), path);
  const content = stringify(data);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}
