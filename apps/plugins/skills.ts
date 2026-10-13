import path from 'node:path';
import { loadSkillFile } from '../skills/index.js';
import type { PluginLogger, PluginSkill } from './types.js';

/**
 * Load plugin skills into the shared skill index.
 *
 * Plugin `skills/<name>/SKILL.md` files parse through the same
 * `parseSkillFile` path as global/builtin/project skills (Agent Skills
 * open standard), so superpowers-style plugins load unchanged. The
 * `pluginId` tag records provenance for the menu and the `skill` tool.
 * Fail-open per skill: one broken SKILL.md never blocks the rest.
 */

/** Load every skill body for one plugin directory. Never throws. */
export async function loadPluginDirSkills(
  pluginId: string,
  dir: string,
  skillNames: string[],
  logger?: PluginLogger,
): Promise<PluginSkill[]> {
  const out: PluginSkill[] = [];
  for (const name of skillNames) {
    const file = path.join(dir, 'skills', name, 'SKILL.md');
    let loaded;
    try {
      loaded = await loadSkillFile(file);
    } catch (err) {
      logger?.warn({ err, file }, 'plugins: skill load failed, skipped');
      continue;
    }
    if (!loaded) continue;
    out.push({
      name: loaded.name,
      description: loaded.description,
      location: loaded.location,
      directory: loaded.directory,
      pluginId,
    });
  }
  return out;
}
