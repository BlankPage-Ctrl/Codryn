import type { SkillMeta } from '../skills/index.js';
import type { CodrynPluginManifest, PluginHookRule, PluginToolDecl } from './native.js';

/**
 * plugin is a folder on disk that identifies itself by means of
 * `codryn-plugin.json` (Codryn-native manifest). The external database
 * only informs about the location of plugins, and never tells what these plugins
 * actually provide. Each plugin's capabilities come from the plugin folder.
 * Perhaps this system has something to consider:
 *    - MCP is MCP, plugin is plugin:
 *      the plugin directory never puts in MCP servers, servers are registered separately
 *      in Codryn MCP configuration when needed.
 *    - For now, it only supports: manifests, skill bodies, bootstrap texts, and hooks
 *      messages are in plain text. So the plugins used then have or require a Media
 *      output (such as image, video, binary, or files from the plugin) cannot be
 *      processed or is at least ignored.
 */

/** How a plugin is sourced. Only `local` resolves in phase 1. */
export type PluginSourceKind = 'local' | 'git';

/** One entry in a plugins registry file (`plugins.json`). */
export interface PluginEntry {
  /** Unique id, lowercase alphanumeric + hyphen (matches skill name rules). */
  id: string;
  /** Local directory path (absolute, or relative to the registry file). */
  path?: string;
  /** Remote git URL (recorded but not auto-cloned in phase 1). */
  source?: string;
  /** Pinned ref for remote sources (tag, branch, or commit). */
  ref?: string;
  enabled?: boolean;
}

export type PluginSource = PluginEntry;

export type PluginStatus = 'ready' | 'not-installed' | 'error' | 'disabled';

/** What a plugin declares about itself (scanned from its own directory). */
export interface PluginCaps {
  /** `codryn` (has codryn-plugin.json) or `bare` (plain skills dir). */
  format: 'codryn' | 'bare';
  name: string;
  description: string;
  version: string | null;
  /** Skill names found under the skills directory (one SKILL.md per skill). */
  skills: string[];
  /** Explicit permissions (manifest) or scanned fallback (bare dirs). */
  permissions: { shell: boolean; network: boolean; sensitive: boolean };
  /** Session-start text from the manifest lifecycle (text only). */
  bootstrap: string | null;
  /** Declarative hook rules from the manifest (data, never code). */
  hookRules: PluginHookRule[];
  /** Tool declarations from the manifest (author-trusted, empty for bare). */
  tools: PluginToolDecl[];
  limits: { maxSkills: number; maxSkillBytes: number };
  /** Human-readable notes (fallback used, id mismatch, caps applied). */
  notices: string[];
}

export type { CodrynPluginManifest };

/** Runtime state of one plugin for a workspace. */
export interface PluginState {
  id: string;
  path: string | null;
  source: PluginSourceKind;
  enabled: boolean;
  status: PluginStatus;
  error: string | null;
  caps: PluginCaps | null;
}

/** A plugin skill, tagged with its origin plugin for menu display. */
export interface PluginSkill extends SkillMeta {
  pluginId: string;
}

/** Logger surface used by the plugin layer (mirrors SkillLogger). */
export interface PluginLogger {
  debug(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
}
