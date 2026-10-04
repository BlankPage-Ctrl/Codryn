import path from 'node:path';
import { findGlobalSkillFiles, snapshotRoots } from './scanner.js';
import { loadProjectSkills, scanProjectSkillFiles } from './project-scan.js';
import { loadBuiltinSkills } from './builtin.js';
import { loadSkillFile } from './parser.js';
import type { ProjectSkillPort, SkillLogger, SkillMeta } from './types.js';

/**
 * Indexing + rescan-on-use
 *
 * Three sources, merged into one in-memory index keyed by the source pair:
 * - Global `~/.agents/skills` (plain `node:fs`).
 * - Builtin `apps/skills/builtin` (shipped with the repo, hardcoded).
 * - Project `<project>/.agents/skills` (via `fm-services` port).
 *
 * On duplicate names the PROJECT skill wins, then BUILTIN, then global:
 * disk-local overrides beat shipped defaults, shipped defaults beat user
 * globals. There is no DB table and no file watcher. Freshness comes from
 * revalidating at the two points the agent actually needs skills:
 * (a) `start.message-run` before building the system prompt,
 * (b) every `skill` tool `execute()` before lookup - which re-reads the
 * requested body fresh, so edits and deletions surface immediately.
 * (Builtin skills are static, so they never invalidate the cache snapshot.)
 */

const CACHE_TTL_MS = 15_000;

export interface SkillSources {
  globalRoot: string;
  project: ProjectSkillPort | null;
}

type Origin = { kind: 'global' } | { kind: 'builtin' } | { kind: 'project'; rel: string };

interface CacheEntry {
  key: string;
  globalMtime: string | null;
  projectFiles: string[];
  cachedAt: number;
  skills: SkillMeta[];
  origins: Map<string, Origin>;
}

const cache = new Map<string, CacheEntry>();

export function skillCacheKey(sources: SkillSources): string {
  return `${sources.globalRoot}::${sources.project?.root ?? '-'}`;
}

function snapshotEqual(
  a: CacheEntry,
  b: Pick<CacheEntry, 'globalMtime' | 'projectFiles'>,
): boolean {
  if (a.globalMtime !== b.globalMtime) return false;
  if (a.projectFiles.length !== b.projectFiles.length) return false;
  return a.projectFiles.every((f, i) => f === b.projectFiles[i]);
}

async function currentSnapshot(
  sources: SkillSources,
): Promise<Pick<CacheEntry, 'globalMtime' | 'projectFiles'>> {
  const snap = await snapshotRoots([sources.globalRoot]);
  const projectFiles = sources.project
    ? await scanProjectSkillFiles(sources.project).catch(() => [])
    : [];
  return { globalMtime: snap.mtimes[0] ?? null, projectFiles: [...projectFiles].sort() };
}

async function scanAndIndex(sources: SkillSources, logger?: SkillLogger): Promise<CacheEntry> {
  const [globalFiles, projectSkills, builtinSkills] = await Promise.all([
    findGlobalSkillFiles(sources.globalRoot),
    sources.project ? loadProjectSkills(sources.project).catch(() => []) : Promise.resolve([]),
    loadBuiltinSkills(logger).catch(() => []),
  ]);
  const globalSkills = (await Promise.all(globalFiles.map((f) => loadSkillFile(f)))).filter(
    (s): s is SkillMeta & { content: string } => s != null,
  );

  // Global first, builtin second, project last -> project wins over
  // builtin, builtin wins over global on duplicate names.
  const byName = new Map<string, { meta: SkillMeta; origin: Origin }>();
  for (const skill of globalSkills) {
    byName.set(skill.name, {
      meta: {
        name: skill.name,
        description: skill.description,
        location: skill.location,
        directory: skill.directory,
      },
      origin: { kind: 'global' },
    });
  }
  for (const skill of builtinSkills) {
    if (byName.has(skill.name)) {
      logger?.warn(
        { name: skill.name, location: skill.location },
        'duplicate skill name — builtin skill overrides global',
      );
    }
    byName.set(skill.name, {
      meta: {
        name: skill.name,
        description: skill.description,
        location: skill.location,
        directory: skill.directory,
      },
      origin: { kind: 'builtin' },
    });
  }
  for (const skill of projectSkills) {
    if (byName.has(skill.name)) {
      logger?.warn(
        { name: skill.name, location: skill.location },
        'duplicate skill name — project skill overrides builtin/global',
      );
    }
    const meta: SkillMeta = {
      name: skill.name,
      description: skill.description,
      location: skill.location,
      directory: skill.directory,
    };
    // loadProjectSkills returns absolute locations; keep the port-relative
    // path for fresh re-reads through the (containment-scoped) port.
    // Separator-aware: `path.join` yields `\` on Windows while scan rels
    // use `/`, so try both prefixes.
    let rel = meta.location;
    const root = sources.project?.root;
    if (root) {
      const sepPrefix = root.endsWith(path.sep) ? root : root + path.sep;
      const fwdPrefix = root.endsWith('/') ? root : `${root}/`;
      if (meta.location.startsWith(sepPrefix)) {
        rel = meta.location.slice(sepPrefix.length);
      } else if (meta.location.startsWith(fwdPrefix)) {
        rel = meta.location.slice(fwdPrefix.length);
      }
    }
    byName.set(skill.name, { meta, origin: { kind: 'project', rel } });
  }

  const skills: SkillMeta[] = [];
  const origins = new Map<string, Origin>();
  for (const [name, v] of byName) {
    skills.push(v.meta);
    origins.set(name, v.origin);
  }
  // Project skills first (workspace-local overrides are the most
  // relevant), then builtin defaults, then globals - alphabetical within
  // each origin. This single ordering feeds both the system-prompt menu
  // and the `skill_list` tool, so the two can never disagree about
  // "first N".
  skills.sort((a, b) => {
    const rank = (name: string): number => {
      const kind = origins.get(name)?.kind;
      if (kind === 'project') return 0;
      if (kind === 'builtin') return 1;
      return 2;
    };
    const pa = rank(a.name);
    const pb = rank(b.name);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  const snap = await currentSnapshot(sources);
  const entry: CacheEntry = {
    key: skillCacheKey(sources),
    globalMtime: snap.globalMtime,
    projectFiles: snap.projectFiles,
    cachedAt: Date.now(),
    skills,
    origins,
  };
  cache.set(entry.key, entry);
  logger?.debug(
    {
      globalRoot: sources.globalRoot,
      project: sources.project?.root ?? null,
      count: skills.length,
    },
    'skills indexed',
  );
  return entry;
}

async function ensureFresh(sources: SkillSources, logger?: SkillLogger): Promise<CacheEntry> {
  const key = skillCacheKey(sources);
  const hit = cache.get(key);
  if (hit) {
    const ttlOk = Date.now() - hit.cachedAt < CACHE_TTL_MS;
    if (ttlOk) {
      const snap = await currentSnapshot(sources).catch(() => null);
      if (snap && snapshotEqual(hit, snap)) return hit;
    } else {
      // TTL expired - still honor a matching snapshot to avoid rescanning
      // hot loops when nothing changed.
      const snap = await currentSnapshot(sources).catch(() => null);
      if (snap && snapshotEqual(hit, snap)) {
        hit.cachedAt = Date.now();
        return hit;
      }
    }
  }
  return scanAndIndex(sources, logger);
}

export async function loadSkillsForWorkspace(
  sources: SkillSources,
  logger?: SkillLogger,
): Promise<SkillMeta[]> {
  try {
    return (await ensureFresh(sources, logger)).skills;
  } catch (err) {
    logger?.warn({ err }, 'skill scan failed — continuing without skills');
    return [];
  }
}

async function readFreshBody(
  sources: SkillSources,
  meta: SkillMeta,
  origin: Origin,
): Promise<string | null> {
  if (origin.kind === 'project' && sources.project) {
    return sources.project.readFile(origin.rel).catch(() => null);
  }
  // Global and builtin skills live at absolute paths outside any workspace
  // containment, so plain `node:fs` re-reads are safe here.
  const loaded = await loadSkillFile(meta.location);
  return loaded?.content ?? null;
}

export async function loadSkillContent(
  sources: SkillSources,
  name: string,
  logger?: SkillLogger,
): Promise<{ meta: SkillMeta; body: string } | null> {
  let entry: CacheEntry;
  try {
    entry = await ensureFresh(sources, logger);
  } catch (err) {
    logger?.warn({ err, name }, 'skill reload failed');
    return null;
  }

  const tryRead = async (e: CacheEntry): Promise<{ meta: SkillMeta; body: string } | null> => {
    const meta = e.skills.find((s) => s.name === name);
    const origin = e.origins.get(name);
    if (!meta || !origin) return null;
    const body = await readFreshBody(sources, meta, origin).catch(() => null);
    if (body == null) return null;
    return { meta, body };
  };

  const found = await tryRead(entry);
  if (found) return found;

  // Name vanished or body unreadable between menu injection and tool call
  // (deleted/renamed/edited) - rescan once so the error path offers a
  // fresh list.
  try {
    entry = await scanAndIndex(sources, logger);
  } catch {
    return null;
  }
  return tryRead(entry);
}

export function cachedSkillMenu(sources: SkillSources): SkillMeta[] {
  return cache.get(skillCacheKey(sources))?.skills ?? [];
}

export function clearSkillCache(): void {
  cache.clear();
}
