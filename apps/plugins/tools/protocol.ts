export const PluginToolMethods = {
  LIST: 'tools/list',
  CALL: 'tools/call',
} as const;

export type PluginToolMethod = (typeof PluginToolMethods)[keyof typeof PluginToolMethods];

export interface PluginToolsListParams {
  // Intentionally empty - plugin returns all tools.
  _placeholder?: never;
}

export interface PluginToolsListResult {
  /** Names of the tools the plugin implements. */
  tools: string[];
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
