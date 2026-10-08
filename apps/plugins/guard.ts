import { isPluginEnabled, type PluginSettingsPort } from './settings.js';
import { loadPluginRegistry } from './external-registry.js';
import { scanPluginCaps } from './manifest.js';
import { loadPluginDirSkills } from './skills.js';
import {
  applyGlobalLimits,
  DEFAULT_PLUGIN_CONFIG,
  toPluginLimits,
  type PluginGlobalLimits,
} from './config.js';
import type { PluginLogger, PluginSkill, PluginState } from './types.js';

/**
 * Guard middleware (sits between Codryn and every plugin).
 *
 * Nothing from a plugin touches the agent or the system without passing
 * through here:
 * - Enabled check: registry `enabled` flag AND workspace settings toggle.
 *   Either side can switch a plugin off; both must agree for it to run.
 * - Capability gate: explicit manifest permissions are announced in the
 *   bootstrap so the model asks first, while the existing per-tool HITL
 *   resolvers (file/shell) stay the enforcement point - this layer
 *   declares, the tool layer enforces. Declarative `deny` hook rules are
 *   enforced here: by tool name (tool removed) and by shell command
 *   pattern (call aborted before any prompt).
 * - Failure isolation: one broken plugin (missing dir, bad manifest)
 *   degrades to a per-plugin error slot, never to a failed run.
 */

export interface PluginLoadResult {
  states: PluginState[];
  skills: PluginSkill[];
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

/**
 * Load every registered plugin for a workspace: resolve, check toggles,
 * scan self-declared caps, load skill bodies. Never throws - failures
 * land in per-plugin error slots.
 */
export async function loadPluginStates(
  projectPath: string,
  workspaceId: string,
  settings: PluginSettingsPort | null,
  logger?: PluginLogger,
  limits: PluginGlobalLimits = toPluginLimits(DEFAULT_PLUGIN_CONFIG),
): Promise<PluginLoadResult> {
  const states: PluginState[] = [];
  const skills: PluginSkill[] = [];

  let entries;
  try {
    entries = await loadPluginRegistry(projectPath, { logger });
  } catch (err) {
    logger?.warn({ err }, 'plugins: registry load failed, continuing without plugins');
    return { states, skills };
  }
  if (entries.length > limits.maxPlugins) {
    logger?.warn(
      { total: entries.length, max: limits.maxPlugins },
      'plugins: registry capped by server config',
    );
    entries = entries.slice(0, Math.max(0, limits.maxPlugins));
  }

  for (const { entry, dir, kind } of entries) {
    if (entry.enabled === false) {
      states.push({
        id: entry.id,
        path: dir,
        source: kind,
        enabled: false,
        status: 'disabled',
        error: null,
        caps: null,
      });
      continue;
    }
    if (settings) {
      try {
        if (!(await isPluginEnabled(settings, workspaceId, entry.id))) {
          states.push({
            id: entry.id,
            path: dir,
            source: kind,
            enabled: false,
            status: 'disabled',
            error: null,
            caps: null,
          });
          continue;
        }
      } catch (err) {
        // Fail-open: a settings failure must never disable a plugin.
        logger?.warn(
          { err, plugin: entry.id },
          'plugins: enabled check failed, treating as enabled',
        );
      }
    }
    if (!dir) {
      states.push({
        id: entry.id,
        path: null,
        source: kind,
        enabled: true,
        status: 'not-installed',
        error: 'Remote plugin source is recorded but not downloaded yet.',
        caps: null,
      });
      continue;
    }
    const caps = await scanPluginCaps(entry.id, dir, logger);
    if (!caps) {
      states.push({
        id: entry.id,
        path: dir,
        source: kind,
        enabled: true,
        status: 'error',
        error: 'Plugin directory has no readable skills.',
        caps: null,
      });
      continue;
    }
    const capped = applyGlobalLimits(caps, limits);
    const effectiveCaps = {
      ...caps,
      skills: capped.skills,
      tools: capped.tools,
      notices: [...caps.notices, ...capped.notices],
    };
    if (effectiveCaps.skills.length === 0) {
      states.push({
        id: entry.id,
        path: dir,
        source: kind,
        enabled: true,
        status: 'error',
        error: 'Plugin has no skills after server limits were applied.',
        caps: null,
      });
      continue;
    }
    const dirSkills = await loadPluginDirSkills(entry.id, dir, effectiveCaps.skills, logger);
    skills.push(...dirSkills);
    states.push({
      id: entry.id,
      path: dir,
      source: kind,
      enabled: true,
      status: 'ready',
      error: null,
      caps: effectiveCaps,
    });
  }

  return { states, skills };
}

export function buildPluginBootstrap(states: PluginState[]): string | null {
  const lines: string[] = [];
  for (const state of states) {
    if (!state.enabled || state.status !== 'ready' || !state.caps?.bootstrap) continue;
    lines.push(oneLine(state.caps.bootstrap));
  }
  if (lines.length === 0) return null;
  return lines.join('\n');
}
