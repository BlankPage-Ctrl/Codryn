import type { PluginServerConfig } from '../shared/types.js';
import type { PluginCaps } from './types.js';
import type { PluginToolDecl } from './native.js';

export interface PluginGlobalLimits {
  maxPlugins: number;
  maxSkillsPerPlugin: number;
  maxToolsPerPlugin: number;
}

export const DEFAULT_PLUGIN_CONFIG: PluginServerConfig = {
  enabled: false,
  maxPlugins: 8,
  maxSkillsPerPlugin: 40,
  maxToolsPerPlugin: 16,
};

export function toPluginLimits(config: Partial<PluginServerConfig>): PluginGlobalLimits {
  return {
    maxPlugins: config.maxPlugins ?? DEFAULT_PLUGIN_CONFIG.maxPlugins,
    maxSkillsPerPlugin: config.maxSkillsPerPlugin ?? DEFAULT_PLUGIN_CONFIG.maxSkillsPerPlugin,
    maxToolsPerPlugin: config.maxToolsPerPlugin ?? DEFAULT_PLUGIN_CONFIG.maxToolsPerPlugin,
  };
}

export interface CappedPluginCaps {
  skills: string[];
  tools: PluginToolDecl[];
  notices: string[];
}

/**
 * Apply global ceilings to scanned caps. Pure: returns the capped lists
 * plus human-readable notices (shown in list/get APIs, never to the
 * model). Manifest-level caps applied earlier are kept when tighter.
 */
export function applyGlobalLimits(caps: PluginCaps, global: PluginGlobalLimits): CappedPluginCaps {
  const notices: string[] = [];
  let skills = caps.skills;
  if (skills.length > global.maxSkillsPerPlugin) {
    notices.push(
      `skill list capped by server config at ${global.maxSkillsPerPlugin} (found ${skills.length}).`,
    );
    skills = skills.slice(0, Math.max(0, global.maxSkillsPerPlugin));
  }
  let tools = caps.tools;
  if (tools.length > global.maxToolsPerPlugin) {
    notices.push(
      `tool list capped by server config at ${global.maxToolsPerPlugin} (found ${tools.length}).`,
    );
    tools = tools.slice(0, Math.max(0, global.maxToolsPerPlugin));
  }
  return { skills, tools, notices };
}
