import type { PluginInternalManifest } from './types.js';

/**
 * The tunnel vocabulary: session control only. Everything a plugin can offer
 * (tools, hooks) lives in its own consumer layer and brings its own methods.
 */
export const PluginSessionMethods = {
  /** Handshake; the plugin replies with its internal manifest. */
  INITIALIZE: 'initialize',
  PING: 'ping',
  SHUTDOWN: 'shutdown',
} as const;

export type PluginSessionMethod = (typeof PluginSessionMethods)[keyof typeof PluginSessionMethods];

/** One JSON-RPC 2.0 frame. */
export interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface PluginInitializeParams {
  pluginId: string;
  workspaceId: string;
  cwd: string;
}

export interface PluginInitializeResult {
  manifest: PluginInternalManifest;
}

export interface PluginPingParams {
  // Intentionally empty.
  _placeholder?: never;
}

export interface PluginPingResult {
  pong: true;
}

export interface PluginShutdownParams {
  // Intentionally empty.
  _placeholder?: never;
}

export interface PluginShutdownResult {
  shutdown: true;
}

export const PluginErrorCode = {
  PLUGIN_NOT_READY: -32000,
  PLUGIN_TIMEOUT: -32001,
  TOOL_NOT_FOUND: -32002,
  TOOL_EXECUTION_FAILED: -32003,
  INVALID_RESPONSE: -32004,
  PLUGIN_CRASHED: -32005,
} as const;

export type PluginErrorCode = (typeof PluginErrorCode)[keyof typeof PluginErrorCode];
