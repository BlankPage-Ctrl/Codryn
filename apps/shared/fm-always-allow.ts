import path from 'node:path';

/**
 * For now its RAM-only "always allow" store for outside-workspace file approvals.
 * The approval lives exactly as long as the process and is scoped to one chat.
 * Restart the backend and every outside path needs approval again.
 *
 * NOTE on granularity (directory-prefix): each entry is matched as a PREFIX -
 * approving `/tmp/codryn` covers everything under it
 * (`/tmp/codryn/a/b.md`), while approving `/tmp/codryn/note.md` covers
 * just that file (exact match is a prefix of itself). This is deliberately
 * broader than exact-file matching so one approval unblocks exploring a
 * shared folder; the blast radius stays bounded because the store is
 * RAM-only, per-chat, and read-only operations are the only ones that can
 * reach this store (writes outside the workspace are hard-denied).
 */
const approvals = new Map<string, Set<string>>();

/** Upper bound per chat so a runaway session cannot grow memory unbounded. */
const MAX_ENTRIES_PER_KEY = 200;

export function fmAlwaysKey(
  workspaceId: string | null | undefined,
  chatId: string | null | undefined,
): string | null {
  if (!workspaceId || !chatId) return null;
  return `${workspaceId}:${chatId}`;
}

function normalizeAbsolute(p: string): string {
  const resolved = path.resolve(p);
  return resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
}

export function isFmAlwaysAllowed(key: string | null, absolutePath: string): boolean {
  if (!key) return false;
  const set = approvals.get(key);
  if (!set || set.size === 0) return false;
  const candidate = normalizeAbsolute(absolutePath);
  for (const entry of set) {
    if (candidate === entry || candidate.startsWith(entry + path.sep)) {
      return true;
    }
  }
  return false;
}

export function addFmAlwaysAllowed(key: string | null, absolutePath: string): boolean {
  if (!key) return false;
  const entry = normalizeAbsolute(absolutePath);
  let set = approvals.get(key);
  if (!set) {
    set = new Set();
    approvals.set(key, set);
  }
  if (set.has(entry)) return false;
  set.add(entry);
  // Evict oldest first (Set iterates in insertion order).
  while (set.size > MAX_ENTRIES_PER_KEY) {
    const oldest = set.values().next().value as string | undefined;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  return true;
}

export function clearFmAlwaysAllowed(key: string | null): void {
  if (!key) return;
  approvals.delete(key);
}
