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
  /** Hook names this plugin observes (e.g. beforeTool, afterTool). */
  hooks: string[];
  /** Codryn tool capabilities this plugin needs (e.g. shell, file, network). */
  requiresCodrynTools: string[];
}

/** Observe-only hook payload. */
export interface PluginHookPayload {
  pluginId: string;
  /** Present on tool-related hooks. */
  tool?: string;
  args?: unknown;
  /** Present on after* hooks. */
  result?: unknown;
  toolCallId?: string;
  /** Milliseconds since epoch. */
  timestamp: number;
}

export interface PluginToolResult {
  ok: boolean;
  /** What the agent sees. */
  text: string;
  code?: string;
  message?: string;
}

export type PluginProcessState = 'spawning' | 'initializing' | 'ready' | 'error' | 'closed';

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
