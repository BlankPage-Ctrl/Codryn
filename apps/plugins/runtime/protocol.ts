import type { PluginInternalManifest, PluginInternalTool, PluginHookPayload } from './types.js';

export type { PluginInternalTool } from './types.js';

export const PluginMethods = {
  /** Handshake; the plugin replies with its internal manifest. */
  INITIALIZE: 'initialize',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  PING: 'ping',
  SHUTDOWN: 'shutdown',
} as const;

export type PluginMethod = (typeof PluginMethods)[keyof typeof PluginMethods];

export const PluginHookMethods = {
  BEFORE_TOOL: 'hooks/beforeTool',
  AFTER_TOOL: 'hooks/afterTool',
  BEFORE_EXECUTE: 'hooks/beforeExecute',
  AFTER_EXECUTE: 'hooks/afterExecute',
} as const;

export type PluginHookMethod = (typeof PluginHookMethods)[keyof typeof PluginHookMethods];

export const PluginHookNames = {
  BEFORE_TOOL: 'beforeTool',
  AFTER_TOOL: 'afterTool',
  BEFORE_EXECUTE: 'beforeExecute',
  AFTER_EXECUTE: 'afterExecute',
} as const;

export type PluginHookName = (typeof PluginHookNames)[keyof typeof PluginHookNames];

export const ALL_HOOK_NAMES: PluginHookName[] = Object.values(PluginHookNames);

export const HOOK_NAME_TO_METHOD: Record<PluginHookName, PluginHookMethod> = {
  beforeTool: PluginHookMethods.BEFORE_TOOL,
  afterTool: PluginHookMethods.AFTER_TOOL,
  beforeExecute: PluginHookMethods.BEFORE_EXECUTE,
  afterExecute: PluginHookMethods.AFTER_EXECUTE,
};

export const HOOK_METHOD_TO_NAME: Record<PluginHookMethod, PluginHookName> = {
  [PluginHookMethods.BEFORE_TOOL]: 'beforeTool',
  [PluginHookMethods.AFTER_TOOL]: 'afterTool',
  [PluginHookMethods.BEFORE_EXECUTE]: 'beforeExecute',
  [PluginHookMethods.AFTER_EXECUTE]: 'afterExecute',
};

export interface PluginInitializeParams {
  pluginId: string;
  workspaceId: string;
  cwd: string;
}

export interface PluginInitializeResult {
  manifest: PluginInternalManifest;
}

export interface PluginToolsListParams {
  // Intentionally empty - plugin returns all tools.
  _placeholder?: never;
}

export interface PluginToolsListResult {
  tools: PluginInternalTool[];
}

export interface PluginToolsCallParams {
  name: string;
  arguments: Record<string, unknown>;
  toolCallId?: string;
}

export interface PluginToolsCallResult {
  ok: boolean;
  text: string;
  code?: string;
  message?: string;
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

export interface PluginHookNotification {
  jsonrpc: '2.0';
  method: PluginHookMethod;
  params: PluginHookPayload;
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
