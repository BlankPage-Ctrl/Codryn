import type { SkillMeta } from '../skills/index.js';
import type { CodrynPluginManifest, PluginToolDecl } from './native.js';

export type PluginSourceKind = 'local' | 'git';

export interface PluginRegistryEntry {
  id: string;
  /** Local directory path (absolute, or relative to the registry file). */
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
