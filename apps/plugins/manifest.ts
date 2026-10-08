import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadCodrynManifest } from './native.js';
import { dedupeToolDecls, scanToolDeclarations } from './safety.js';
import type { PluginCaps, PluginLogger } from './types.js';

/**
 * Load system registry (self-declaration).
 *
 * The plugin tells Codryn what it contains through `codryn-plugin.json`
 * plus `skills/<name>/SKILL.md` (Agent Skills open standard). A directory
 * with skills but no manifest still loads as `bare` with conservative
 * defaults so plain skill folders keep working.
 */

const MAX_SKILL_SCAN_BYTES = 1_000_000;

const SENSITIVE_RE = /secret|password|token|api[-_ ]?key|credential|private[-_ ]?key/i;
const SHELL_RE =
  /\brun_shell\b|shell command|run a shell|execute (a|the) command|subprocess|child_process/i;

async function listSkillNames(dir: string, logger?: PluginLogger): Promise<string[]> {
  const skillsDir = path.join(dir, 'skills');
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    try {
      const stat = await fs.stat(skillFile);
      if (stat.isFile() && stat.size <= MAX_SKILL_SCAN_BYTES) names.push(entry.name);
    } catch (err) {
      logger?.warn({ err, skillFile }, 'plugins: unreadable skill file, skipped');
    }
  }
  return names.sort();
}

interface BodyFlags {
  sensitive: boolean;
  shell: boolean;
  rejected: string[];
}

async function scanSkillBodies(
  dir: string,
  skillNames: string[],
  maxSkillBytes: number,
): Promise<BodyFlags> {
  const flags: BodyFlags = { sensitive: false, shell: false, rejected: [] };
  for (const name of skillNames) {
    const file = path.join(dir, 'skills', name, 'SKILL.md');
    try {
      const stat = await fs.stat(file);
      if (stat.size > Math.min(maxSkillBytes, MAX_SKILL_SCAN_BYTES)) {
        flags.rejected.push(name);
        continue;
      }
      const body = await fs.readFile(file, 'utf8');
      if (body.includes('\u0000')) {
        flags.rejected.push(name);
        continue;
      }
      if (!flags.sensitive && SENSITIVE_RE.test(body)) flags.sensitive = true;
      if (!flags.shell && SHELL_RE.test(body)) flags.shell = true;
    } catch {
      flags.rejected.push(name);
    }
  }
  return flags;
}

/** Scan one plugin directory into self-declared capabilities. Never throws. */
export async function scanPluginCaps(
  id: string,
  dir: string,
  logger?: PluginLogger,
): Promise<PluginCaps | null> {
  try {
    const rootStat = await fs.stat(dir);
    if (!rootStat.isDirectory()) return null;
  } catch {
    return null;
  }

  const loaded = await loadCodrynManifest(dir);
  const notices = [...loaded.notices];
  const skillNames = await listSkillNames(dir, logger);
  if (skillNames.length === 0) return null;

  const manifest = loaded.manifest;
  if (manifest && manifest.id !== id) {
    notices.push(`manifest id "${manifest.id}" does not match registry id "${id}".`);
  }

  const maxSkills = manifest?.limits.maxSkills ?? 40;
  const maxSkillBytes = manifest?.limits.maxSkillBytes ?? MAX_SKILL_SCAN_BYTES;
  let kept = skillNames;
  if (kept.length > maxSkills) {
    notices.push(`skill list capped at ${maxSkills} (found ${kept.length}).`);
    kept = kept.slice(0, maxSkills);
  }
  const flags = await scanSkillBodies(dir, kept, maxSkillBytes);
  const skills = kept.filter((name) => !flags.rejected.includes(name));
  if (flags.rejected.length > 0) {
    notices.push(`rejected non-text or oversized skills: ${flags.rejected.join(', ')}.`);
  }
  if (skills.length === 0) return null;

  if (manifest) {
    const tools = dedupeToolDecls(manifest.tools);
    notices.push(...scanToolDeclarations(manifest.tools));
    return {
      format: 'codryn',
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      skills,
      permissions: { ...manifest.permissions },
      bootstrap: manifest.lifecycle.bootstrap ?? null,
      hookRules: manifest.hooks.rules.map((rule) => ({ ...rule })),
      tools: tools.map((tool) => ({ ...tool })),
      limits: { maxSkills, maxSkillBytes },
      notices,
    };
  }

  notices.push('no codryn-plugin.json; loaded as a bare skills directory with scanned defaults.');
  return {
    format: 'bare',
    name: id,
    description: `External plugin "${id}" (${skills.length} skill${skills.length === 1 ? '' : 's'}).`,
    version: null,
    skills,
    permissions: { shell: flags.shell, network: false, sensitive: flags.sensitive },
    bootstrap: null,
    hookRules: [],
    tools: [],
    limits: { maxSkills, maxSkillBytes },
    notices,
  };
}
