import path from 'node:path';
import { PathTraversalError } from '../errors/traversal.js';

export { PathTraversalError } from '../errors/traversal.js';

export function normalizeRequestedPath(requestedPath: string): string {
  return requestedPath === '/' ? '.' : requestedPath;
}

/**
 * True when a `path.relative()` result escapes its base.
 * Must match a whole `..` segment: `..`, `../x` (posix) or `..\x`
 * (win32). A plain prefix check misclassifies valid names like `..foo`
 * as outside.
 */
export function isOutsideRelative(
  relative: string,
  opts?: { sep?: string; isAbsolute?: (p: string) => boolean },
): boolean {
  const sep = opts?.sep ?? path.sep;
  const isAbs = opts?.isAbsolute ?? path.isAbsolute;
  return relative === '..' || relative.startsWith(`..${sep}`) || isAbs(relative);
}

/**
 * Same check for display paths produced by `toRelativePath()`, which are
 * always `/`-joined regardless of platform.
 */
export function isOutsideDisplayPath(displayPath: string): boolean {
  return displayPath === '..' || displayPath.startsWith('../');
}

export interface WorkspacePathClassification {
  inside: boolean;
  absolutePath: string;
}

/**
 * Pure string classifier: is `requestedPath` inside `workspaceRoot`?
 * `./src/foo.ts` -> inside; `/tmp/codryn/x`, `../escape` =>
 * outside. No filesystem access - safe to call before any approval.
 */
export function classifyWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): WorkspacePathClassification {
  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(normalizedRoot, normalizeRequestedPath(requestedPath));
  const relative = path.relative(normalizedRoot, resolved);

  if (isOutsideRelative(relative)) {
    return { inside: false, absolutePath: resolved };
  }
  return { inside: true, absolutePath: resolved };
}

export function resolveSafePath(workspaceRoot: string, requestedPath: string): string {
  const classified = classifyWorkspacePath(workspaceRoot, requestedPath);
  if (!classified.inside) {
    throw new PathTraversalError(requestedPath);
  }
  return classified.absolutePath;
}

export function toRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
  return relativePath === '' ? '/' : relativePath.split(path.sep).join('/');
}
