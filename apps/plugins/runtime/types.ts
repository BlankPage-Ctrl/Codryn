/**
 * Unlike the registry manifest (codryn-plugin.json, static on disk), the
 * internal manifest is reported by the plugin itself at runtime.
 */
export interface PluginInternalManifest {
  /** May differ from the registry manifest name. */
  name: string;
  version: string;
  description: string;
  /** Names of the tools the plugin implements. */
  tools: string[];
  /** Names of the hooks the plugin listens to. */
  hooks: string[];
  /** The mode the plugin implements per hook, when it reports one. */
  hookModes?: Record<string, string>;
  /** Codryn tool capabilities this plugin needs (e.g. shell, file, network). */
  requiresCodrynTools: string[];
}

export type PluginProcessState = 'spawning' | 'initializing' | 'ready' | 'error' | 'closed';

/** A request a plugin sends to Codryn. */
export interface PluginRequestMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
}

export interface PluginProcessHandle {
  id: string;
  state: PluginProcessState;
  /** Null until initialize completes. */
  internalManifest: PluginInternalManifest | null;
  /** Empty until ready. */
  tools: string[];
  /** Empty until ready. */
  hooks: string[];
  /** Set when state is 'error'. */
  error: string | null;
  spawnedAt: number;
  /** For health checks. */
  lastActivityAt: number;
}
