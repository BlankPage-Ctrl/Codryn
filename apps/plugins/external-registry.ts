import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { loadCodrynManifest } from './native.js';
import type { PluginLogger } from './types.js';

export const PLUGINS_DIR = path.join(os.homedir(), '.codryn', 'backend', 'plugins');
export const PLUGINS_REGISTRY_FILE = path.join(PLUGINS_DIR, 'plugins.json');

const PluginRegistryEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    path: z.string().trim().min(1).optional(),
    enabled: z.boolean().default(true),
  })
  .passthrough();

const PluginsRegistryFileSchema = z
  .object({
    plugins: z.array(PluginRegistryEntrySchema).default([]),
  })
  .passthrough();

export interface PluginRegistryEntry {
  id: string;
  path?: string;
  enabled: boolean;
}

export interface DiscoveredPlugin {
  id: string;
  dir: string;
  registered: boolean;
  enabled: boolean;
  manifestValid: boolean;
  notices: string[];
}

function normalizeId(raw: string): string | null {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
  return id;
}

function resolvePluginDir(entry: PluginRegistryEntry): string {
  if (entry.path) {
    const raw = entry.path.trim();
    if (!raw) return path.join(PLUGINS_DIR, entry.id);
    return path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(PLUGINS_DIR, raw));
  }
  return path.join(PLUGINS_DIR, entry.id);
}

async function readRegistryFile(
  file: string,
  logger?: PluginLogger,
): Promise<{ entries: PluginRegistryEntry[]; exists: boolean }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { entries: [], exists: false };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    logger?.warn({ err, file }, 'plugins: registry JSON parse failed');
    return { entries: [], exists: true };
  }
  const parsed = PluginsRegistryFileSchema.safeParse(doc);
  if (!parsed.success) {
    logger?.warn({ file }, 'plugins: registry schema invalid');
    return { entries: [], exists: true };
  }
  const entries: PluginRegistryEntry[] = [];
  for (const item of parsed.data.plugins) {
    const id = normalizeId(item.id);
    if (!id) {
      logger?.warn({ id: item.id }, 'plugins: skipping entry with invalid id');
      continue;
    }
    entries.push({ ...item, id });
  }
  return { entries, exists: true };
}

async function writeRegistryFile(
  file: string,
  entries: PluginRegistryEntry[],
  logger?: PluginLogger,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ plugins: entries }, null, 2) + '\n');
  } catch (err) {
    logger?.warn({ err, file }, 'plugins: failed to write registry file');
    throw err;
  }
}

export async function discoverPlugins(logger?: PluginLogger): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];
  const dirsToCheck: string[] = [];
  const seenDirs = new Set<string>();

  function pushDir(dir: string): void {
    const normalized = path.normalize(dir);
    if (seenDirs.has(normalized)) return;
    seenDirs.add(normalized);
    dirsToCheck.push(normalized);
  }

  // Scan plugins directory
  try {
    const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        pushDir(path.join(PLUGINS_DIR, entry.name));
      }
    }
  } catch {
    // plugins dir does not exist yet, that is fine
  }

  // Read registry
  const { entries: registryEntries } = await readRegistryFile(PLUGINS_REGISTRY_FILE, logger);
  const registryById = new Map(registryEntries.map((e) => [e.id, e]));
  const registryByDir = new Map<string, PluginRegistryEntry>();
  for (const entry of registryEntries) {
    const resolved = path.normalize(resolvePluginDir(entry));
    registryByDir.set(resolved, entry);
    // Include registered custom paths so their manifest gets validated too.
    pushDir(resolved);
  }

  const seenIds = new Map<string, number>();

  // Check each directory (both scanned and registered custom paths)
  for (const dir of dirsToCheck) {
    const normalizedDir = path.normalize(dir);
    const byDir = registryByDir.get(normalizedDir);
    let id: string | null = byDir ? byDir.id : null;
    if (!id) {
      id = normalizeId(path.basename(normalizedDir));
      if (!id) continue;
    }

    const registryEntry = registryById.get(id) ?? byDir;
    const notices: string[] = [];
    let manifestValid = false;

    try {
      await fs.stat(normalizedDir);
    } catch {
      notices.push('Plugin directory not found.');
      const record: DiscoveredPlugin = {
        id,
        dir: normalizedDir,
        registered: registryEntry !== undefined,
        enabled: registryEntry?.enabled ?? true,
        manifestValid: false,
        notices,
      };
      const existingIdx = seenIds.get(id);
      if (existingIdx !== undefined) discovered[existingIdx] = record;
      else {
        seenIds.set(id, discovered.length);
        discovered.push(record);
      }
      continue;
    }

    const manifestPath = path.join(normalizedDir, 'codryn-plugin.json');
    try {
      const stat = await fs.stat(manifestPath);
      if (stat.isFile()) {
        const { manifest, notices: manifestNotices } = await loadCodrynManifest(normalizedDir);
        manifestValid = manifest !== null;
        notices.push(...manifestNotices);
        if (!manifestValid) {
          notices.push('codryn-plugin.json failed validation.');
        }
      } else {
        notices.push('No codryn-plugin.json found.');
      }
    } catch {
      notices.push('No codryn-plugin.json found.');
    }

    const record: DiscoveredPlugin = {
      id,
      dir: normalizedDir,
      registered: registryEntry !== undefined,
      enabled: registryEntry?.enabled ?? true,
      manifestValid,
      notices,
    };
    const existingIdx = seenIds.get(id);
    if (existingIdx !== undefined) {
      // Prefer the explicitly registered location on id collision.
      if (byDir) discovered[existingIdx] = record;
    } else {
      seenIds.set(id, discovered.length);
      discovered.push(record);
    }
  }

  return discovered.sort((a, b) => a.id.localeCompare(b.id));
}

export async function registerPlugin(
  pluginId: string,
  pluginDir?: string,
  logger?: PluginLogger,
): Promise<PluginRegistryEntry> {
  const id = normalizeId(pluginId);
  if (!id) throw new Error(`Invalid plugin id: ${pluginId}`);

  const { entries } = await readRegistryFile(PLUGINS_REGISTRY_FILE, logger);
  const existing = entries.find((e) => e.id === id);
  if (existing) {
    throw new Error(`Plugin ${id} is already registered`);
  }

  const entry: PluginRegistryEntry = { id, enabled: true };
  if (pluginDir) entry.path = pluginDir;

  entries.push(entry);
  await writeRegistryFile(PLUGINS_REGISTRY_FILE, entries, logger);
  return entry;
}

export async function unregisterPlugin(pluginId: string, logger?: PluginLogger): Promise<void> {
  const id = normalizeId(pluginId);
  if (!id) throw new Error(`Invalid plugin id: ${pluginId}`);

  const { entries, exists } = await readRegistryFile(PLUGINS_REGISTRY_FILE, logger);
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) {
    throw new Error(`Plugin ${id} is not registered`);
  }

  if (exists) {
    await writeRegistryFile(PLUGINS_REGISTRY_FILE, filtered, logger);
  }
}

export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  logger?: PluginLogger,
): Promise<PluginRegistryEntry> {
  const id = normalizeId(pluginId);
  if (!id) throw new Error(`Invalid plugin id: ${pluginId}`);

  const { entries, exists } = await readRegistryFile(PLUGINS_REGISTRY_FILE, logger);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    throw new Error(`Plugin ${id} is not registered`);
  }

  entry.enabled = enabled;
  if (exists) {
    await writeRegistryFile(PLUGINS_REGISTRY_FILE, entries, logger);
  }
  return entry;
}

export async function loadRegisteredPlugins(
  logger?: PluginLogger,
): Promise<Array<{ entry: PluginRegistryEntry; dir: string }>> {
  const { entries } = await readRegistryFile(PLUGINS_REGISTRY_FILE, logger);
  return entries.map((entry) => ({
    entry,
    dir: resolvePluginDir(entry),
  }));
}

export { resolvePluginDir };
