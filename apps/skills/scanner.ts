import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILL_FILENAME = 'SKILL.md';
const MAX_SCAN_DEPTH = 6;
const NEVER_DESCEND = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

/** Host Scanning for `~/.agents/skills` only.
 * only two sources exist, this global root (plain `node:fs`, outside every workspace
 * containment) and the project skill dir
 */
export function resolveGlobalRoot(): string {
  return path.join(os.homedir(), '.agents', 'skills');
}

function shouldDescend(name: string): boolean {
  if (NEVER_DESCEND.has(name)) return false;
  if (name.startsWith('.')) return false;
  return true;
}

export async function findGlobalSkillFiles(root?: string): Promise<string[]> {
  const resolved = root ?? resolveGlobalRoot();
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    return []; // global skill dir absent - normal. Skip silent.
  }

  const visited = new Set<string>([real]);
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: real, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_SCAN_DEPTH) continue;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable / vanished mid-scan - skip silent.
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === SKILL_FILENAME && entry.isFile()) {
        out.push(full);
        continue;
      }
      const isDir = entry.isDirectory() || entry.isSymbolicLink();
      if (!isDir || !shouldDescend(entry.name)) continue;
      let target = full;
      if (entry.isSymbolicLink()) {
        try {
          target = await fs.realpath(full);
        } catch {
          continue;
        }
        if (visited.has(target)) continue;
      }
      visited.add(target);
      queue.push({ dir: target, depth: depth + 1 });
    }
  }

  return [...new Set(out)];
}

export async function snapshotRoots(
  roots: string[],
): Promise<{ roots: string[]; mtimes: Array<string | null> }> {
  const mtimes = await Promise.all(
    roots.map(async (root) => {
      try {
        const st = await fs.stat(root);
        return String(st.mtimeMs);
      } catch {
        // Distinguish missing (null) from present - a newly created skill
        // dir must invalidate the cache.
        return null;
      }
    }),
  );
  return { roots, mtimes };
}
