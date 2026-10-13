import type { Logger } from '../shared/types.js';
import {
  PluginProcess,
  type PluginProcessOptions,
  type PluginRuntimeConfig,
} from './runtime/process.js';
import type {
  PluginProcessHandle,
  PluginInternalTool,
  PluginHookPayload,
} from './runtime/types.js';
import { HOOK_NAME_TO_METHOD, type PluginHookName } from './runtime/protocol.js';
import type { CodrynPluginManifest } from './native.js';

export interface PluginHostOptions {
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  logger?: Logger;
}

export interface PluginHostEntry {
  id: string;
  /** Registry manifest (from codryn-plugin.json). */
  manifest: CodrynPluginManifest;
  dir: string;
  workspaceId: string;
  runtime: PluginRuntimeConfig;
  /** Null until spawned. */
  process: PluginProcess | null;
}

export class PluginHost {
  private plugins = new Map<string, PluginHostEntry>();
  private timeoutMs: number;
  private spawnTimeoutMs: number;
  private logger: Logger;

  constructor(opts: PluginHostOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.spawnTimeoutMs = opts.spawnTimeoutMs ?? 10_000;
    this.logger = opts.logger ?? console;
  }

  register(id: string, manifest: CodrynPluginManifest, dir: string, workspaceId: string): void {
    if (!manifest.runtime) {
      this.logger.warn({ plugin: id }, 'plugin: no runtime config, skipping');
      return;
    }

    this.plugins.set(id, {
      id,
      manifest,
      dir,
      workspaceId,
      runtime: manifest.runtime,
      process: null,
    });
  }

  registerMany(
    plugins: Array<{
      id: string;
      manifest: CodrynPluginManifest;
      dir: string;
      workspaceId: string;
    }>,
  ): void {
    for (const p of plugins) {
      this.register(p.id, p.manifest, p.dir, p.workspaceId);
    }
  }

  getPlugin(id: string): PluginHostEntry | null {
    return this.plugins.get(id) ?? null;
  }

  getAllPlugins(): PluginHostEntry[] {
    return [...this.plugins.values()];
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error(`Plugin ${id} not registered`);
    if (!enabled && entry.process) {
      await entry.process.close();
      entry.process = null;
    }
  }

  /** Spawn on first use; reuses a healthy process. */
  async ensurePlugin(id: string): Promise<PluginProcessHandle> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin ${id} not registered`);
    }

    if (entry.process?.isReady) {
      return entry.process.handle;
    }

    if (entry.process && !entry.process.isReady) {
      await entry.process.close().catch(() => {});
      entry.process = null;
    }

    const processOpts: PluginProcessOptions = {
      id,
      runtime: entry.runtime,
      workspaceId: entry.workspaceId,
      cwd: entry.dir,
      timeoutMs: this.timeoutMs,
      spawnTimeoutMs: this.spawnTimeoutMs,
      logger: this.logger,
    };

    const process = new PluginProcess(processOpts);
    entry.process = process;

    try {
      const handle = await process.start();
      return handle;
    } catch (err) {
      entry.process = null;
      throw err;
    }
  }

  getReadyPlugins(): PluginProcessHandle[] {
    const handles: PluginProcessHandle[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.process?.isReady) {
        handles.push(entry.process.handle);
      }
    }
    return handles;
  }

  getRegisteredIds(): string[] {
    return [...this.plugins.keys()];
  }

  listTools(): PluginInternalTool[] {
    const tools: PluginInternalTool[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.process?.isReady) {
        tools.push(...entry.process.handle.tools);
      }
    }
    return tools;
  }

  findPluginForTool(toolName: string): PluginHostEntry | null {
    for (const entry of this.plugins.values()) {
      if (!entry.process?.isReady) continue;
      const tools = entry.process.handle.tools;
      if (tools.some((t) => t.name === toolName)) {
        return entry;
      }
    }
    return null;
  }

  /** Tool names are "pluginId__toolName". The child process only knows the bare name. */
  async callTool(
    namespacedToolName: string,
    args: Record<string, unknown>,
    toolCallId?: string,
  ): Promise<{ ok: boolean; text: string; code?: string; message?: string }> {
    const match = namespacedToolName.match(/^([a-z0-9-]+)__([a-z0-9_-]+)$/i);
    const pluginId = match?.[1];
    const bareName = match?.[2] ?? namespacedToolName;
    const entry =
      this.findPluginForTool(bareName) ?? (pluginId ? this.plugins.get(pluginId) : undefined);
    if (!entry?.process?.isReady) {
      return {
        ok: false,
        text: `Tool ${namespacedToolName} not found`,
        code: 'TOOL_NOT_FOUND',
        message: `Plugin for tool ${namespacedToolName} not found`,
      };
    }

    return entry.process.callTool(bareName, args, toolCallId);
  }

  /**
   * Observe-only notifications, no response expected.
   * Gated twice: registry manifest must enable the hook, and the live
   * process must have subscribed to it during initialize.
   */
  dispatchHook(hookName: PluginHookName, payload: PluginHookPayload): void {
    const method = HOOK_NAME_TO_METHOD[hookName];

    for (const entry of this.plugins.values()) {
      const manifestHookEnabled = entry.manifest.hooks?.[hookName] === true;
      if (!manifestHookEnabled) continue;

      if (!entry.process?.isReady) continue;
      const hookSubscribed = entry.process.handle.hooks.includes(hookName);
      if (!hookSubscribed) continue;

      entry.process.notify(method, payload).catch((err) => {
        this.logger.warn({ err, plugin: entry.id, hook: hookName }, 'plugin hook dispatch failed');
      });
    }
  }

  isHookSubscribed(pluginId: string, hookName: PluginHookName): boolean {
    const entry = this.plugins.get(pluginId);
    if (!entry) return false;
    const manifestHookEnabled = entry.manifest.hooks?.[hookName] === true;
    if (!manifestHookEnabled) return false;
    if (!entry.process?.isReady) return false;
    return entry.process.handle.hooks.includes(hookName);
  }

  getHookSubscribers(hookName: PluginHookName): string[] {
    const subscribers: string[] = [];
    for (const entry of this.plugins.values()) {
      if (this.isHookSubscribed(entry.id, hookName)) {
        subscribers.push(entry.id);
      }
    }
    return subscribers;
  }

  async closePlugin(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (entry?.process) {
      await entry.process.close();
      entry.process = null;
    }
  }

  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.process) {
        promises.push(entry.process.close());
        entry.process = null;
      }
    }
    await Promise.all(promises);
  }

  /** Closes the process if running. */
  async unregister(id: string): Promise<void> {
    await this.closePlugin(id);
    this.plugins.delete(id);
  }
}
