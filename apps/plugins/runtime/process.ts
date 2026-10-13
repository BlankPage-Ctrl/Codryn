/**
 * Manages one plugin child process: spawn, initialize handshake,
 * request/response correlation, graceful shutdown.
 *
 * Communication is newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * stderr is log-only, never part of the protocol.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Logger } from '../../shared/types.js';
import {
  PluginMethods,
  type PluginInitializeParams,
  type PluginInitializeResult,
  type PluginToolsListResult,
  type PluginToolsCallParams,
  type PluginToolsCallResult,
  type PluginPingResult,
  type PluginHookMethod,
} from './protocol.js';
import type {
  PluginProcessHandle,
  PluginProcessState,
  PluginInternalManifest,
  PluginInternalTool,
  PluginHookPayload,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SPAWN_TIMEOUT_MS = 10_000;

export interface PluginRuntimeConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface PluginProcessOptions {
  id: string;
  runtime: PluginRuntimeConfig;
  workspaceId: string;
  cwd: string;
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  logger?: Logger;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class PluginProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private state: PluginProcessState = 'spawning';
  private internalManifest: PluginInternalManifest | null = null;
  private tools: PluginInternalTool[] = [];
  private hooks: string[] = [];
  private error: string | null = null;
  private spawnedAt = Date.now();
  private lastActivityAt = Date.now();
  private timeoutMs: number;
  private spawnTimeoutMs: number;
  private logger: Logger;
  private closing = false;

  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;

  constructor(private opts: PluginProcessOptions) {
    super();
    this.id = opts.id;
    this.workspaceId = opts.workspaceId;
    this.cwd = opts.cwd;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnTimeoutMs = opts.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    this.logger = opts.logger ?? console;
  }

  get handle(): PluginProcessHandle {
    return {
      id: this.id,
      state: this.state,
      internalManifest: this.internalManifest,
      tools: this.tools,
      hooks: this.hooks,
      error: this.error,
      spawnedAt: this.spawnedAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Resolves once the initialize handshake completes. */
  async start(): Promise<PluginProcessHandle> {
    if (this.child) {
      throw new Error(`Plugin ${this.id} already started`);
    }

    this.state = 'spawning';
    this.spawnedAt = Date.now();
    this.lastActivityAt = Date.now();

    const { command, args, cwd, env } = this.opts.runtime;
    // Relative runtime cwd is resolved against the plugin directory, not the
    // backend process cwd. A bare "." therefore keeps the plugin dir.
    const spawnCwd =
      !cwd || cwd.trim() === ''
        ? this.cwd
        : path.isAbsolute(cwd)
          ? cwd
          : path.resolve(this.cwd, cwd);

    this.child = spawn(command, args, {
      cwd: spawnCwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');

    this.child.stdout?.on('data', (chunk: string) => {
      this.lastActivityAt = Date.now();
      this.buffer += chunk;
      this.processBuffer();
    });

    this.child.stderr?.on('data', (chunk: string) => {
      this.lastActivityAt = Date.now();
      this.logger.debug({ plugin: this.id, stderr: chunk.trim() }, 'plugin stderr');
    });

    this.child.on('error', (err) => {
      this.state = 'error';
      this.error = err.message;
      this.rejectAllPending(new Error(`Plugin ${this.id} process error: ${err.message}`));
      this.emit('error', err);
    });

    this.child.on('exit', (code, signal) => {
      if (this.closing) return;
      this.state = 'closed';
      const msg = `Plugin ${this.id} exited (code=${code}, signal=${signal})`;
      this.rejectAllPending(new Error(msg));
      this.emit('exit', { code, signal });
    });

    await this.waitForSpawn();

    this.state = 'initializing';
    try {
      const result = (await this.request(PluginMethods.INITIALIZE, {
        pluginId: this.id,
        workspaceId: this.workspaceId,
        cwd: this.cwd,
      } satisfies PluginInitializeParams)) as PluginInitializeResult;

      this.internalManifest = result.manifest;
      this.tools = result.manifest.tools;
      this.hooks = result.manifest.hooks;
      this.state = 'ready';
      this.lastActivityAt = Date.now();

      this.logger.info(
        { plugin: this.id, tools: this.tools.length, hooks: this.hooks.length },
        'plugin ready',
      );

      return this.handle;
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.kill();
      throw err;
    }
  }

  /** Times out per timeoutMs; rejects all pending on process exit. */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child || this.state === 'closed' || this.state === 'error') {
      throw new Error(`Plugin ${this.id} is not ready (state: ${this.state})`);
    }

    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Plugin ${this.id} request timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin?.write(message);
    });
  }

  /** Fire-and-forget; dropped unless state is ready. */
  async notify(method: PluginHookMethod, params: PluginHookPayload): Promise<void> {
    if (!this.child || this.state !== 'ready') return;

    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    try {
      this.child.stdin?.write(message);
      this.lastActivityAt = Date.now();
    } catch (err) {
      this.logger.warn({ err, plugin: this.id, method }, 'plugin notify failed');
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    toolCallId?: string,
  ): Promise<PluginToolsCallResult> {
    const params: PluginToolsCallParams = { name, arguments: args, toolCallId };
    const result = (await this.request(PluginMethods.TOOLS_CALL, params)) as PluginToolsCallResult;
    return result;
  }

  async listTools(): Promise<PluginInternalTool[]> {
    const result = (await this.request(PluginMethods.TOOLS_LIST, {})) as PluginToolsListResult;
    return result.tools;
  }

  async ping(): Promise<boolean> {
    try {
      const result = (await this.request(PluginMethods.PING, {})) as PluginPingResult;
      return result.pong === true;
    } catch {
      return false;
    }
  }

  /** Shutdown request first; SIGTERM, then SIGKILL after 2s if still alive. */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;

    if (this.child && this.state === 'ready') {
      try {
        await this.request(PluginMethods.SHUTDOWN, {});
      } catch {
        // ignore shutdown errors
      }
    }

    // Brief pause so the plugin can exit on its own after shutdown.
    await new Promise((r) => setTimeout(r, 500));

    this.kill();
    this.state = 'closed';
    this.rejectAllPending(new Error(`Plugin ${this.id} closed`));
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 2000);
    }
    this.child = null;
  }

  private waitForSpawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin ${this.id} spawn timeout`));
      }, this.spawnTimeoutMs);

      this.child!.once('spawn', () => {
        clearTimeout(timer);
        resolve();
      });

      this.child!.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    let msg: { id?: string | number | null; method?: string; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.warn({ plugin: this.id, line: line.slice(0, 200) }, 'plugin: invalid JSON');
      return;
    }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id as string | number);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id as string | number);
        if (msg.error) {
          const err = msg.error as { code: number; message: string };
          pending.reject(new Error(`Plugin ${this.id} error ${err.code}: ${err.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Not consumed yet; kept so plugin-initiated messages are not dropped silently.
    if (msg.method && msg.id === undefined) {
      this.emit('notification', msg);
      return;
    }

    if (msg.method && msg.id !== undefined) {
      this.emit('request', msg);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
