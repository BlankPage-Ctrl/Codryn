import path from 'node:path';
import type { IFileSystem } from '../types/file-system.js';
import { classifyWorkspacePath, isOutsideRelative } from './path.js';

export interface OutsideTarget {
  inside: boolean;
  absolutePath: string;
  /** True when the escape happens via a symlink (final or ancestor dir). */
  viaSymlink: boolean;
  symlinkPath?: string;
}

/** Max symlink-chain hops followed while resolving (cycle protection). */
const MAX_SYMLINK_HOPS = 8;

/**
 * Decide whether `requestedPath` escapes `workspaceRoot`.
 *
 * 1. String escape (`../x`, `/tmp/codryn/...`) => outside immediately,
 *    WITHOUT touching the filesystem (no pre-approval FS access at all).
 * 2. String-inside => best-effort symlink probe: `lstat` the target and each
 *    ancestor dir up to the root; a symlink whose resolved target lands
 *    outside counts as outside (`viaSymlink: true`). Chains are followed
 *    (a => b => /outside). Probe failures (ENOENT, EPERM, ...) fall back to
 *    inside so the normal flow can report the real error (e.g. a typo inside
 *    the workspace must be PATH_NOT_FOUND, never an approval prompt).
 *
 * Only metadata syscalls are used here - never content reads.
 */
export async function resolveOutsideTarget(
  fs: IFileSystem,
  workspaceRoot: string,
  requestedPath: string,
): Promise<OutsideTarget> {
  const root = path.resolve(workspaceRoot);
  let current = classifyWorkspacePath(root, requestedPath).absolutePath;

  const first = classifyWorkspacePath(root, current);
  if (!first.inside) {
    return { inside: false, absolutePath: first.absolutePath, viaSymlink: false };
  }

  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
    const escaped = await findEscapingSymlink(fs, root, current);
    if (!escaped) {
      return { inside: true, absolutePath: first.absolutePath, viaSymlink: false };
    }
    const targetClass = classifyWorkspacePath(root, escaped.target);
    if (!targetClass.inside) {
      return {
        inside: false,
        absolutePath: targetClass.absolutePath,
        viaSymlink: true,
        symlinkPath: escaped.link,
      };
    }
    // Link points back inside - keep checking the resolved path so chained
    // links (inside-link => inside-link => outside) are still caught.
    current = path.join(targetClass.absolutePath, escaped.remainder);
  }
  // Too many hops (possible cycle): fail closed as inside and let the normal
  // flow surface the FS error rather than opening an approval prompt.
  return { inside: true, absolutePath: first.absolutePath, viaSymlink: false };
}

/**
 * Walk `absolutePath` and its ancestors (down to but not including `root`)
 * looking for the shallowest symlink. Returns the link, its resolved target,
 * and the path remainder below the link.
 */
async function findEscapingSymlink(
  fs: IFileSystem,
  root: string,
  absolutePath: string,
): Promise<{ link: string; target: string; remainder: string } | null> {
  let cursor = absolutePath;
  for (;;) {
    // The workspace root itself is never probed: a symlinked root is a
    // legitimate setup, not an escape.
    if (cursor === root) return null;
    let stats;
    try {
      stats = await fs.lstat(cursor);
    } catch {
      return null; // ENOENT/EPERM/... => best-effort: no verdict from this level.
    }
    if (stats.isSymbolicLink()) {
      let raw: string;
      try {
        raw = await fs.readlink(cursor);
      } catch {
        return null;
      }
      const remainder = path.relative(cursor, absolutePath);
      return {
        link: cursor,
        target: path.resolve(path.dirname(cursor), raw),
        remainder: remainder === '' ? '' : remainder,
      };
    }
    const parent = path.dirname(cursor);
    // Safety stop: never ascend above the workspace root.
    if (parent === cursor || parent.length < root.length) return null;
    const rel = path.relative(root, parent);
    if (isOutsideRelative(rel)) return null;
    cursor = parent;
  }
}
