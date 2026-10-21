import { EventEmitter } from 'node:events';
import type { Logger } from '../shared/types.js';
import {
  PluginProcess,
  type PluginProcessOptions,
  type PluginRuntimeConfig,
} from './runtime/process.js';
import type {
  PluginInternalManifest,
  PluginProcessHandle,
  PluginRequestMessage,
} from './runtime/types.js';
import type { CodrynPluginManifest } from './native.js';

export interface PluginHostOptions {
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  logger?: Logger;
}

/** What a consumer layer may know about a registered plugin. */
export interface PluginDescriptor {
  id: string;
  /** Registry manifest (from codryn-plugin.json). */
  manifest: CodrynPluginManifest;
  dir: string;
  workspaceId: string;
}

interface PluginHostEntry extends PluginDescriptor {
  runtime: PluginRuntimeConfig;
  /** Null until spawned. */
  process: PluginProcess | null;
}

/** A request that arrived from a plugin. */
export interface PluginIncomingRequest {
  pluginId: string;
  message: PluginRequestMessage;
}

/**
 * The tunnel: it owns the plugin processes and moves frames.
 *
 * It knows nothing about what the frames mean. A consumer layer (tools, hooks)
 * brings its own methods and asks for them here.
 */
export class PluginHost extends EventEmitter {
  private plugins = new Map<string, PluginHostEntry>();
  private timeoutMs: number;
  private spawnTimeoutMs: number;
  readonly logger: Logger;

  constructor(opts: PluginHostOptions = {}) {
    super();
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

  getPlugin(id: string): PluginDescriptor | null {
    const entry = this.plugins.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      manifest: entry.manifest,
      dir: entry.dir,
      workspaceId: entry.workspaceId,
    };
  }

  getAllPlugins(): PluginDescriptor[] {
    return [...this.plugins.values()].map((entry) => ({
      id: entry.id,
      manifest: entry.manifest,
      dir: entry.dir,
      workspaceId: entry.workspaceId,
    }));
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

    const pluginProcess = new PluginProcess(processOpts);
    pluginProcess.on('request', (message: PluginRequestMessage) => {
      this.emit('request', { pluginId: id, message } satisfies PluginIncomingRequest);
    });
    entry.process = pluginProcess;

    try {
      const handle = await pluginProcess.start();
      return handle;
    } catch (err) {
      entry.process = null;
      throw err;
    }
  }

  isPluginReady(id: string): boolean {
    return this.plugins.get(id)?.process?.isReady === true;
  }

  /** What the plugin reported at handshake, null when it never did. */
  getRuntimeManifest(id: string): PluginInternalManifest | null {
    return this.plugins.get(id)?.process?.handle.internalManifest ?? null;
  }

  getRegisteredIds(): string[] {
    return [...this.plugins.keys()];
  }

  /** Sends a frame to a plugin without waiting for an answer. */
  async notifyPlugin(pluginId: string, method: string, params?: unknown): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry?.process?.isReady) return;
    await entry.process.notify(method, params);
  }

  /** Sends a frame to a plugin and waits for its answer. */
  async requestPlugin(
    pluginId: string,
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    const entry = this.plugins.get(pluginId);
    if (!entry?.process?.isReady) {
      throw new Error(`Plugin ${pluginId} is not ready`);
    }
    return entry.process.request(method, params, timeoutMs ? { timeoutMs } : undefined);
  }

  /** Answers a request a plugin sent to Codryn. */
  async respondPlugin(pluginId: string, id: string | number, result: unknown): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry?.process?.isReady) return;
    await entry.process.respond(id, result);
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
