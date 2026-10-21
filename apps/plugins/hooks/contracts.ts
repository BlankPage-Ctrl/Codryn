import { z } from 'zod';
import type { PluginHookName } from './names.js';

export const HOOK_MODES = ['observe', 'transform', 'veto'] as const;

export type HookMode = (typeof HOOK_MODES)[number];

/** One plugin listening to one hook, with the rights it claimed. */
export interface HookTarget {
  pluginId: string;
  mode: HookMode;
  stage: string;
  priority: number;
}

export interface HookContract {
  /** Bumped whenever the payload shape changes. */
  version: number;
  /** Modes a plugin may claim for this hook. */
  modes: HookMode[];
  /** JSON Schema of the payload Codryn sends. */
  payload: Record<string, unknown>;
  /** Top-level payload paths a plugin may write. */
  writable: string[];
  /**
   * Ordered stage names. Writers of one stage run in parallel and conflict
   * with each other; a later stage sees the result of the earlier ones.
   */
  stages: string[];
}

export const PluginHookModeSchema = z.enum(HOOK_MODES);

export const PluginHookDeclSchema = z.object({
  mode: PluginHookModeSchema.default('observe'),
  /** Stage of this hook the writer belongs to. */
  stage: z.string().trim().min(1).max(64).optional(),
  /** Lower wins a contested path. */
  priority: z.number().int().min(0).max(1_000).default(100),
});

/** `true` is the legacy form and means observe. */
export const PluginHookEntrySchema = z.union([z.boolean(), PluginHookDeclSchema]);

export type PluginHookDecl = z.infer<typeof PluginHookDeclSchema>;

const TOOL_OWNER = {
  type: 'string',
  description: 'Owner of the tool: a plugin id, or "codryn" for built-in tools.',
};

const BEFORE_TOOL_PAYLOAD = {
  type: 'object',
  properties: {
    pluginId: TOOL_OWNER,
    tool: { type: 'string' },
    args: { type: 'object' },
    toolCallId: { type: 'string' },
    timestamp: { type: 'number' },
  },
  required: ['pluginId', 'tool', 'args', 'timestamp'],
};

const AFTER_TOOL_PAYLOAD = {
  type: 'object',
  properties: {
    pluginId: TOOL_OWNER,
    tool: { type: 'string' },
    result: { type: 'string' },
    ok: { type: 'boolean' },
    toolCallId: { type: 'string' },
    timestamp: { type: 'number' },
  },
  required: ['pluginId', 'tool', 'result', 'timestamp'],
};

const BEFORE_EXECUTE_PAYLOAD = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    chatId: { type: 'string' },
    workspaceId: { type: 'string' },
    mode: { type: 'string' },
    timestamp: { type: 'number' },
  },
  required: ['runId', 'chatId', 'timestamp'],
};

const AFTER_EXECUTE_PAYLOAD = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    chatId: { type: 'string' },
    status: { type: 'string' },
    durationMs: { type: 'number' },
    timestamp: { type: 'number' },
  },
  required: ['runId', 'chatId', 'status', 'timestamp'],
};

const DEFAULT_STAGE = 'default';

/**
 * The catalog Codryn owns. A plugin learns the payload shape from here, and
 * Codryn validates every write against the same schema.
 */
export const HOOK_CONTRACTS: Record<PluginHookName, HookContract> = {
  beforeTool: {
    version: 1,
    modes: ['observe', 'transform', 'veto'],
    payload: BEFORE_TOOL_PAYLOAD,
    writable: ['args'],
    // A stage that is not declared runs last, so an explicit intent wins over
    // an implicit one.
    stages: ['sanitize', 'enrich', DEFAULT_STAGE],
  },
  // Rewriting the tool result stays reserved: afterTool is observe-only until
  // Codryn decides how a rewritten result reaches the model.
  afterTool: {
    version: 1,
    modes: ['observe'],
    payload: AFTER_TOOL_PAYLOAD,
    writable: [],
    stages: [DEFAULT_STAGE],
  },
  beforeExecute: {
    version: 1,
    modes: ['observe', 'veto'],
    payload: BEFORE_EXECUTE_PAYLOAD,
    writable: [],
    stages: [DEFAULT_STAGE],
  },
  afterExecute: {
    version: 1,
    modes: ['observe'],
    payload: AFTER_EXECUTE_PAYLOAD,
    writable: [],
    stages: [DEFAULT_STAGE],
  },
};

export function hookContract(name: PluginHookName): HookContract {
  return HOOK_CONTRACTS[name];
}

export function isHookMode(value: unknown): value is HookMode {
  return typeof value === 'string' && (HOOK_MODES as readonly string[]).includes(value);
}

export function hookAllowsMode(contract: HookContract, mode: HookMode): boolean {
  return contract.modes.includes(mode);
}

export interface HookSubscription {
  subscribed: boolean;
  mode: HookMode;
  stage: string;
  priority: number;
  /** Set when the declaration had to be corrected. */
  notice: string | null;
}

/**
 * Turns a manifest declaration into the effective subscription. A plugin
 * cannot widen its own rights: a mode or stage the contract does not allow is
 * corrected here, not by the plugin.
 */
export function resolveHookSubscription(
  value: boolean | PluginHookDecl | undefined,
  contract: HookContract,
): HookSubscription {
  if (value === undefined || value === false) {
    return {
      subscribed: false,
      mode: 'observe',
      stage: DEFAULT_STAGE,
      priority: 100,
      notice: null,
    };
  }

  const decl: PluginHookDecl =
    value === true ? { mode: 'observe', stage: undefined, priority: 100 } : value;

  let notice: string | null = null;
  let mode = decl.mode;
  if (!hookAllowsMode(contract, mode)) {
    notice = `hook mode "${mode}" is not allowed here; downgraded to observe.`;
    mode = 'observe';
  }

  let stage = DEFAULT_STAGE;
  if (decl.stage) {
    if (contract.stages.includes(decl.stage)) {
      stage = decl.stage;
    } else {
      notice = notice
        ? `${notice} Unknown stage "${decl.stage}"; moved to ${DEFAULT_STAGE}.`
        : `Unknown hook stage "${decl.stage}"; moved to ${DEFAULT_STAGE}.`;
    }
  }

  return { subscribed: true, mode, stage, priority: decl.priority, notice };
}
