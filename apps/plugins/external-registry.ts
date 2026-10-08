import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PluginEntry, PluginLogger } from './types.js';

/**
 * External plugin registry.
 *
 * Two JSON files only (mirrors the skills global/project split):
 * - Global `~/.agents/plugins.json` (plain `node:fs`).
 * - Project `<projectPath>/.agents/plugins.json` (plain `node:fs`,
 *   resolved against the workspace project path).
 *
 * The registry records WHERE plugins live (id + path/source). It never
 * describes WHAT a plugin contains - capabilities always come from the
 * plugin directory itself, so the registry cannot go stale.
 * One bad entry never breaks the rest (fail-open per entry).
 */

export const PLUGINS_FILENAME = 'plugins.json';

const PluginEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    path: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    ref: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

const PluginsFileSchema = z
  .object({
    plugins: z.array(PluginEntrySchema).default([]),
  })
  .passthrough();

export function resolveGlobalPluginsFile(): string {
  return path.join(os.homedir(), '.agents', PLUGINS_FILENAME);
}

export function projectPluginsFile(projectPath: string): string {
  return path.join(path.resolve(projectPath), '.agents', PLUGINS_FILENAME);
}

function sourceKind(entry: PluginEntry): 'local' | 'git' {
  if (entry.path) return 'local';
  return 'git';
}

function normalizeId(raw: string): string | null {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
  return id;
}

/**
 * Resolve a registry entry's directory. Returns null when the entry has no
 * usable locator (neither `path` nor `source`).
 */
export function resolveEntryDir(entry: PluginEntry, registryDir: string): string | null {
  if (entry.path) {
    const raw = entry.path.trim();
    if (!raw) return null;
    const abs = path.isAbsolute(raw)
      ? path.normalize(raw)
      : path.normalize(path.join(registryDir, raw));
    return abs;
  }
  return null;
}

async function readRegistryFile(
  file: string,
  logger?: PluginLogger,
): Promise<{ entries: PluginEntry[]; dir: string }> {
  const dir = path.dirname(file);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { entries: [], dir }; // absent registry file is normal.
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    logger?.warn({ err, file }, 'plugins: registry JSON parse failed, skipping file');
    return { entries: [], dir };
  }
  const parsed = PluginsFileSchema.safeParse(doc);
  if (!parsed.success) {
    logger?.warn({ file }, 'plugins: registry schema invalid, skipping file');
    return { entries: [], dir };
  }
  const entries: PluginEntry[] = [];
  for (const item of parsed.data.plugins) {
    const id = normalizeId(item.id);
    if (!id) {
      logger?.warn({ id: item.id }, 'plugins: skipping entry with invalid id');
      continue;
    }
    entries.push({ ...item, id });
  }
  return { entries, dir };
}

export interface ResolvedPluginEntry {
  entry: PluginEntry;
  /** Absolute plugin directory, or null for remote-only entries. */
  dir: string | null;
  kind: 'local' | 'git';
}

/**
 * Load and merge both registry files. Project entries win over global ones
 * on duplicate ids. Never throws on bad files or bad entries.
 */
export async function loadPluginRegistry(
  projectPath: string,
  opts: { globalFile?: string; logger?: PluginLogger } = {},
): Promise<ResolvedPluginEntry[]> {
  const logger = opts.logger;
  const [global, project] = await Promise.all([
    readRegistryFile(opts.globalFile ?? resolveGlobalPluginsFile(), logger),
    readRegistryFile(projectPluginsFile(projectPath), logger),
  ]);
  const byId = new Map<string, ResolvedPluginEntry>();
  for (const { entries, dir } of [global, project]) {
    for (const entry of entries) {
      const kind = sourceKind(entry);
      byId.set(entry.id, {
        entry,
        dir: kind === 'local' ? resolveEntryDir(entry, dir) : null,
        kind,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.entry.id.localeCompare(b.entry.id));
}
