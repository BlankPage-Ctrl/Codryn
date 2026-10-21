import { hookContract, type HookMode } from './contracts.js';
import { ALL_HOOK_NAMES, type PluginHookName } from './names.js';

export const HOOK_DESCRIBE_METHOD = 'hooks/describe';

export interface BeforeToolPayload {
  /** Owner of the tool: a plugin id, or "codryn" for built-in tools. */
  pluginId: string;
  tool: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  /** Milliseconds since epoch. */
  timestamp: number;
}

export interface AfterToolPayload {
  pluginId: string;
  tool: string;
  result: string;
  ok: boolean;
  toolCallId?: string;
  timestamp: number;
}

export interface BeforeExecutePayload {
  runId: string;
  chatId: string;
  workspaceId: string;
  mode: string;
  timestamp: number;
}

export interface AfterExecutePayload {
  runId: string;
  chatId: string;
  status: string;
  durationMs: number;
  timestamp: number;
}

export interface HookPayloads {
  beforeTool: BeforeToolPayload;
  afterTool: AfterToolPayload;
  beforeExecute: BeforeExecutePayload;
  afterExecute: AfterExecutePayload;
}

export interface PluginHookRequestParams<K extends PluginHookName = PluginHookName> {
  /** Contract version of the payload. */
  version: number;
  /** The payload Codryn sends. */
  payload: HookPayloads[K];
  /** Top-level payload paths the plugin may write. */
  writable: string[];
  /** Epoch milliseconds after which Codryn ignores the reply. */
  deadline: number;
}

export interface PluginHookVeto {
  reason: string;
}

export interface PluginHookResult {
  ok: boolean;
  /** Full replacement payload, transform hooks only. */
  payload?: Record<string, unknown>;
  /** Block reason, veto hooks only. */
  veto?: PluginHookVeto;
  /** Why the plugin declined to answer. */
  reason?: string;
}

export interface PluginHookDescribeEntry {
  name: string;
  version: number;
  /** Modes a plugin may claim for this hook. */
  modes: HookMode[];
  /** JSON Schema of the payload. */
  payload: Record<string, unknown>;
  /** Top-level payload paths a plugin may write. */
  writable: string[];
}

export interface PluginHookDescribeResult {
  hooks: PluginHookDescribeEntry[];
}

/** The catalog a plugin can ask for, so it knows the shape before it writes. */
export function describeHooks(): PluginHookDescribeResult {
  return {
    hooks: ALL_HOOK_NAMES.map((name) => {
      const contract = hookContract(name);
      return {
        name,
        version: contract.version,
        modes: contract.modes,
        payload: contract.payload,
        writable: contract.writable,
      };
    }),
  };
}
