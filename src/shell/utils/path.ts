import { resolve, sep } from 'node:path';

/**
 * Resolve a relative path against a root, refusing paths that escape it.
 * Returns null when the target leaves the root.
 */
export function resolveWithinRoot(root: string, rel: string): string | null {
  const base = resolve(root);
  const target = resolve(base, rel);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}
