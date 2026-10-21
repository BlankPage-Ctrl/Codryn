import type { Logger } from '../../shared/types.js';
import type { IHitlService } from '../../../src/human-in-the-loop/index.js';
import { jsonSchemaToZod } from '../../mcp/json-schema.js';
import type { PluginHookName } from './names.js';
import { hookContract, type HookTarget } from './contracts.js';
import { diffPayload } from './diff.js';
import {
  mergeHookWrites,
  type HookConflict,
  type HookConflictPolicy,
  type HookWrite,
} from './merge.js';
import type { HookPayloads, PluginHookRequestParams, PluginHookResult } from './protocol.js';

export interface HookTransport {
  targets(hookName: PluginHookName): HookTarget[];
  notify(
    pluginId: string,
    hookName: PluginHookName,
    params: PluginHookRequestParams,
  ): Promise<void>;
  request(
    pluginId: string,
    hookName: PluginHookName,
    params: PluginHookRequestParams,
    timeoutMs: number,
  ): Promise<unknown>;
}

export interface HookBusOptions {
  transport: HookTransport;
  logger?: Logger;
  /** When false the bus does nothing and the payload passes through. */
  enabled?: boolean;
  /** Per plugin reply timeout. */
  timeoutMs?: number;
  /** Cap on writers per hook round. */
  maxWriters?: number;
  conflictPolicy?: HookConflictPolicy | 'ask-user';
  hitl?: IHitlService;
}

/** Where a hook round happens, used when the user has to settle a conflict. */
export interface HookContext {
  workspaceId: string;
  chatId: string;
  toolCallId?: string;
}

export interface HookOutcome<K extends PluginHookName = PluginHookName> {
  /** The payload after the applied writes. */
  payload: HookPayloads[K];
  /** True when a plugin vetoed the operation. */
  blocked: boolean;
  blockReason: string | null;
  /** Plugins whose write was applied, with the paths they changed. */
  applied: Array<{ pluginId: string; paths: string[] }>;
  conflicts: HookConflict[];
  errors: Array<{ pluginId: string; message: string }>;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_WRITERS = 4;
const MAX_ASKED_CONFLICTS = 3;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The one place hooks are dispatched.
 *
 * Observers are notified and never awaited. Writers of one stage run in
 * parallel on the same snapshot and are merged afterwards, so no plugin can
 * see or overwrite another plugin's write by accident.
 */
export class HookBus {
  private readonly transport: HookTransport;
  private readonly logger: Logger;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxWriters: number;
  private readonly conflictPolicy: HookConflictPolicy | 'ask-user';
  private readonly hitl: IHitlService | undefined;

  constructor(options: HookBusOptions) {
    this.transport = options.transport;
    this.logger = options.logger ?? console;
    this.enabled = options.enabled ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxWriters = options.maxWriters ?? DEFAULT_MAX_WRITERS;
    this.conflictPolicy = options.conflictPolicy ?? 'reject';
    this.hitl = options.hitl;
  }

  async push<K extends PluginHookName>(
    hookName: K,
    payload: HookPayloads[K],
    context?: HookContext,
  ): Promise<HookOutcome<K>> {
    const contract = hookContract(hookName);
    const targets = this.enabled ? this.transport.targets(hookName) : [];
    const outcome: HookOutcome<K> = {
      payload,
      blocked: false,
      blockReason: null,
      applied: [],
      conflicts: [],
      errors: [],
    };

    const observers = targets.filter((target) => target.mode === 'observe');
    const vetoers = targets.filter((target) => target.mode === 'veto');
    let writers = targets.filter((target) => target.mode === 'transform');

    for (const observer of observers) {
      const params = this.buildParams(hookName, payload);
      this.transport.notify(observer.pluginId, hookName, params).catch((err) => {
        this.logger.warn(
          { err, plugin: observer.pluginId, hook: hookName },
          'plugin hook notify failed',
        );
      });
    }

    if (writers.length > this.maxWriters) {
      writers = [...writers]
        .sort(
          (left, right) =>
            left.priority - right.priority || left.pluginId.localeCompare(right.pluginId),
        )
        .slice(0, this.maxWriters);
      this.logger.warn({ hook: hookName, writers: writers.length }, 'plugin hook writers capped');
    }

    if (vetoers.length > 0) {
      const replies = await Promise.all(
        vetoers.map((vetoer) => this.requestReply(vetoer.pluginId, hookName, payload, outcome)),
      );
      vetoers.forEach((vetoer, index) => {
        const reply = replies[index];
        if (outcome.blocked || !reply?.veto) return;
        outcome.blocked = true;
        outcome.blockReason = reply.veto.reason;
        this.logger.info(
          { plugin: vetoer.pluginId, hook: hookName, reason: reply.veto.reason },
          'plugin vetoed hook',
        );
      });
    }
    if (outcome.blocked) return outcome;

    const priorityOf = new Map(targets.map((target) => [target.pluginId, target.priority]));
    let current: HookPayloads[K] = payload;

    for (const stage of contract.stages) {
      const stageWriters = writers.filter((writer) => writer.stage === stage);
      if (stageWriters.length === 0) continue;

      const replies = await Promise.all(
        stageWriters.map((writer) =>
          this.requestReply(writer.pluginId, hookName, current, outcome),
        ),
      );

      const writes: HookWrite[] = [];
      stageWriters.forEach((writer, index) => {
        const reply = replies[index];
        if (!reply?.payload) return;
        const changes = diffPayload(current, reply.payload, contract.writable);
        if (changes.length === 0) return;
        writes.push({ pluginId: writer.pluginId, changes });
      });
      if (writes.length === 0) continue;

      const merged = await this.mergeStage(current, writes, priorityOf, context);
      current = merged.payload as HookPayloads[K];
      outcome.applied.push(...merged.applied);
      outcome.conflicts.push(...merged.conflicts);

      if (merged.applied.length > 0) {
        this.logger.info({ hook: hookName, applied: merged.applied }, 'plugin hook writes applied');
      }
    }

    outcome.payload = current;
    return outcome;
  }

  private async mergeStage(
    snapshot: unknown,
    writes: HookWrite[],
    priorityOf: Map<string, number>,
    context?: HookContext,
  ): Promise<{
    payload: unknown;
    applied: Array<{ pluginId: string; paths: string[] }>;
    conflicts: HookConflict[];
  }> {
    const priority = (pluginId: string) => priorityOf.get(pluginId) ?? 100;

    if (this.conflictPolicy === 'priority') {
      return mergeHookWrites(snapshot, writes, 'priority', priority);
    }

    if (this.conflictPolicy !== 'ask-user') {
      return mergeHookWrites(snapshot, writes, 'reject', priority);
    }

    const detected = mergeHookWrites(snapshot, writes, 'reject', priority);
    const decisions = new Map<string, string | null>();
    for (const conflict of detected.conflicts.slice(0, MAX_ASKED_CONFLICTS)) {
      decisions.set(conflict.path, await this.askConflict(conflict, context));
    }
    return mergeHookWrites(snapshot, writes, 'reject', priority, (conflict) => {
      if (decisions.has(conflict.path)) return decisions.get(conflict.path) ?? null;
      return null;
    });
  }

  private buildParams<K extends PluginHookName>(
    hookName: K,
    payload: HookPayloads[K],
  ): PluginHookRequestParams<K> {
    const contract = hookContract(hookName);
    return {
      version: contract.version,
      payload,
      writable: contract.writable,
      deadline: Date.now() + this.timeoutMs,
    };
  }

  private async requestReply<K extends PluginHookName>(
    pluginId: string,
    hookName: K,
    payload: HookPayloads[K],
    outcome: HookOutcome<K>,
  ): Promise<PluginHookResult | null> {
    const contract = hookContract(hookName);
    const params = this.buildParams(hookName, payload);

    try {
      const raw = await this.withTimeout(
        this.transport.request(pluginId, hookName, params, this.timeoutMs),
        this.timeoutMs,
        `hook ${hookName} timed out after ${this.timeoutMs}ms`,
      );
      const parsed = this.parseReply(raw, contract.payload);
      if (!parsed.ok) {
        outcome.errors.push({ pluginId, message: parsed.error });
        this.logger.warn({ plugin: pluginId, hook: hookName }, parsed.error);
        return null;
      }
      return parsed.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.errors.push({ pluginId, message });
      this.logger.warn({ err, plugin: pluginId, hook: hookName }, 'plugin hook request failed');
      return null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private parseReply(
    raw: unknown,
    schema: Record<string, unknown>,
  ): { ok: true; result: PluginHookResult } | { ok: false; error: string } {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'hook reply is not an object' };
    }
    if (raw.ok !== true) {
      return {
        ok: true,
        result: { ok: false, reason: typeof raw.reason === 'string' ? raw.reason : undefined },
      };
    }
    const veto =
      isPlainObject(raw.veto) && typeof raw.veto.reason === 'string'
        ? { reason: raw.veto.reason }
        : undefined;
    const payload = isPlainObject(raw.payload) ? raw.payload : undefined;

    if (payload) {
      const parsed = jsonSchemaToZod(schema).safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: 'hook payload rejected by the contract' };
      }
    }

    return { ok: true, result: { ok: true, payload, veto } };
  }

  private async askConflict(conflict: HookConflict, context?: HookContext): Promise<string | null> {
    if (!this.hitl || !context) return null;

    const options = conflict.pluginIds.map((pluginId) => ({
      id: pluginId,
      title: pluginId,
      description: JSON.stringify(conflict.values[pluginId] ?? null).slice(0, 500),
    }));

    try {
      const request = await this.hitl.requestAndWait({
        type: 'choice',
        title: `Plugin conflict on ${conflict.path}`,
        description: 'Two plugins changed the same value. Pick the one Codryn keeps.',
        chatId: context.chatId,
        workspaceId: context.workspaceId,
        executionId: context.toolCallId,
        metadata: { source: 'plugin-hook', path: conflict.path },
        payload: { mode: 'single', options, defaultSelection: [conflict.pluginIds[0]] },
      });
      if (request.type !== 'choice' || !request.response) return null;
      const selected = request.response.selected[0];
      return selected && conflict.pluginIds.includes(selected) ? selected : null;
    } catch {
      return null;
    }
  }
}
