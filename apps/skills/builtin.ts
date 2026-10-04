import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillFile } from './parser.js';
import { SKILL_FILENAME } from './scanner.js';
import type { SkillLogger, SkillMeta } from './types.js';

/**
 * Builtin skills ship with the repo under `apps/skills/builtin/`.
 * They are hardcoded (no user setup needed) but load through the same
 * `skill` tool as global/project skills.
 *
 * Path resolution covers every runtime (plain ASCII paths only):
 * - binary distribution: `make build-backend` stages builtin/ next to the
 *   compiled executable (OUTDIR/skills/builtin), whose module URL lives on
 *   the virtual $bunfs path (no builtin sibling there). Probe the executable
 *   directory first, mirroring resolveMigrationsFolder().
 * - dev/test (`bun`, `tsx`) and `tsc` output: walk up looking for the
 *   `apps/skills/builtin` source dir in the checkout (`tsc` does not copy
 *   `.md` files into `dist/`, hence the walk-up).
 */

function candidateRoots(): string[] {
  const execCand = path.join(path.dirname(process.execPath), 'skills', 'builtin');
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [execCand, path.join(here, 'builtin')];
  let dir = here;
  for (let depth = 0; depth < 8; depth++) {
    roots.push(path.join(dir, 'apps', 'skills', 'builtin'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...new Set(roots)];
}

export async function findBuiltinSkillFiles(): Promise<string[]> {
  for (const root of candidateRoots()) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const out: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = path.join(root, entry.name, SKILL_FILENAME);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) out.push(candidate);
      } catch {
        continue;
      }
    }
    if (out.length > 0) return out.sort();
  }
  return [];
}

export async function loadBuiltinSkills(
  logger?: SkillLogger,
): Promise<Array<SkillMeta & { content: string }>> {
  let files: string[];
  try {
    files = await findBuiltinSkillFiles();
  } catch (err) {
    logger?.warn({ err }, 'builtin skill scan failed');
    return [];
  }
  const loaded = await Promise.all(files.map((f) => loadSkillFile(f)));
  return loaded.filter((s): s is SkillMeta & { content: string } => s != null);
}
