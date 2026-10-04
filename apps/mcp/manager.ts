import { loadMcpConfig } from './config.js';
import {
  McpError,
  SdkMcpConnection,
  type McpConnection,
  type McpPromptDef,
  type McpResourceDef,
  type McpToolDef,
} from './client.js';
import { isMcpServerEnabled, setMcpServerEnabled, type McpSettingsPort } from './settings.js';
import type { McpServerDef } from '../validators/mcp.js';
import type { Logger } from '../shared/types.js';
import { fallbackLogger } from '../shared/logging/fallback.js';

export interface McpManagerConfig {
  enabled: boolean;
  toolsEnabled: boolean;
  /** Implemented + tested, but NOT wired to the production agent path. */
  resourcesEnabled: boolean;
  promptsEnabled: boolean;
  elicitationEnabled: boolean;
  defaultTimeoutMs: number;
  maxServers: number;
  maxToolsPerServer: number;
}

export const DEFAULT_MCP_CONFIG: McpManagerConfig = {
  enabled: true,
  toolsEnabled: true,
  resourcesEnabled: false,
  promptsEnabled: false,
  elicitationEnabled: false,
  defaultTimeoutMs: 60_000,
  maxServers: 8,
  maxToolsPerServer: 32,
};

export interface McpWorkspaceSnapshot {
  workspaceId: string;
  projectPath: string;
  source: string | null;
  servers: string[];
  tools: Array<McpToolDef & { server: string }>;
  resources: Array<McpResourceDef & { server: string }>;
  prompts: Array<McpPromptDef & { server: string }>;
  truncated: boolean;
}

export type McpServerStatus = 'ready' | 'error' | 'disabled';

export interface McpServerState {
  name: string;
  transport: 'stdio' | 'http';
  /** User intent (persisted). Absent key = true. */
  enabled: boolean;
  status: McpServerStatus;
  tools: number;
  /** Per-server failure slot. Null unless status === 'error'. */
  error: string | null;
}

export type McpConnectionFactory = (
  serverName: string,
  def: McpServerDef,
  projectPath: string,
  timeoutMs: number,
  logger: Logger,
) => McpConnection;

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

/**
 * Per-workspace MCP connection cache.
 *
 * - Lazy: nothing connects until the first snapshot for a workspace.
 * - Fail-open: one bad server never breaks the whole workspace; the error
 *   is logged, kept in a per-server slot, and the server is skipped.
 * - User toggles (`workspace:<id>:mcp:<name>`, default ON) are honored by
 *   every read path: disabled servers are never connected and never reach
 *   the agent.
 * - Secrets (`env`/`headers`) never enter logs - only names + counts.
 */
export class McpManager {
  private connections = new Map<string, McpConnection>();
  private snapshots = new Map<string, { at: number; snapshot: McpWorkspaceSnapshot }>();
  private connecting = new Map<string, Promise<McpConnection>>();
  private lastError = new Map<string, string>();

  constructor(
    private readonly config: McpManagerConfig = DEFAULT_MCP_CONFIG,
    private readonly logger: Logger = fallbackLogger('McpManager'),
    private readonly factory: McpConnectionFactory = (name, def, projectPath, timeoutMs, logger) =>
      new SdkMcpConnection(name, def, projectPath, { timeoutMs, logger }),
    private readonly settings: McpSettingsPort | null = null,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  get toolsWired(): boolean {
    return this.config.enabled && this.config.toolsEnabled;
  }

  private key(workspaceId: string, server: string): string {
    return `${workspaceId}\u0000${server}`;
  }

  /** Fail-open: settings failures never disable a server by accident. */
  private async isEnabled(workspaceId: string, serverName: string): Promise<boolean> {
    if (!this.settings) return true;
    try {
      return await isMcpServerEnabled(this.settings, workspaceId, serverName);
    } catch (err) {
      this.logger.warn(
        { err, workspaceId, server: serverName },
        'mcp: enabled check failed, treating as enabled',
      );
      return true;
    }
  }

  private requireSettings(): McpSettingsPort {
    if (!this.settings) {
      throw new McpError('', 'MCP settings store unavailable', 'MCP_SETTINGS_UNAVAILABLE');
    }
    return this.settings;
  }

  private getConnection(
    workspaceId: string,
    serverName: string,
    def: McpServerDef,
    projectPath: string,
  ): Promise<McpConnection> {
    const k = this.key(workspaceId, serverName);
    const existing = this.connections.get(k);
    if (existing) return Promise.resolve(existing);
    const inflight = this.connecting.get(k);
    if (inflight) return inflight;
    const p = (async () => {
      const conn = this.factory(
        serverName,
        def,
        projectPath,
        this.config.defaultTimeoutMs,
        this.logger,
      );
      await conn.connect();
      this.connections.set(k, conn);
      return conn;
    })();
    this.connecting.set(k, p);
    void p.then(
      () => this.connecting.delete(k),
      () => this.connecting.delete(k),
    );
    return p;
  }

  async closeServer(workspaceId: string, serverName: string): Promise<void> {
    const k = this.key(workspaceId, serverName);
    const conn = this.connections.get(k);
    this.connections.delete(k);
    this.lastError.delete(k);
    if (conn) await conn.close().catch(() => {});
  }

  /** Probe one server: connect + count tools. Never throws (error => state). */
  private async probeServer(
    workspaceId: string,
    projectPath: string,
    serverName: string,
    def: McpServerDef,
  ): Promise<McpServerState> {
    const k = this.key(workspaceId, serverName);
    const enabled = await this.isEnabled(workspaceId, serverName);
    if (!enabled) {
      return {
        name: serverName,
        transport: def.transport,
        enabled: false,
        status: 'disabled',
        tools: 0,
        error: null,
      };
    }
    try {
      const conn = await this.getConnection(workspaceId, serverName, def, projectPath);
      const tools = this.config.toolsEnabled ? await conn.listTools() : [];
      this.lastError.delete(k);
      return {
        name: serverName,
        transport: def.transport,
        enabled: true,
        status: 'ready',
        tools: tools.length,
        error: null,
      };
    } catch (err) {
      const message = errMessage(err);
      this.lastError.set(k, message);
      this.logger.warn({ err, workspaceId, server: serverName }, 'mcp: server probe failed');
      return {
        name: serverName,
        transport: def.transport,
        enabled: true,
        status: 'error',
        tools: 0,
        error: message,
      };
    }
  }

  /** Full per-server list for the UI panel. Never throws on server faults. */
  async getServerStates(
    workspaceId: string,
    projectPath: string,
  ): Promise<{ workspaceId: string; source: string | null; servers: McpServerState[] }> {
    if (!this.config.enabled) return { workspaceId, source: null, servers: [] };
    let loaded: Awaited<ReturnType<typeof loadMcpConfig>>;
    try {
      loaded = await loadMcpConfig(projectPath);
    } catch (err) {
      this.logger.warn({ err, workspaceId }, 'mcp: config load failed');
      return { workspaceId, source: null, servers: [] };
    }
    const servers: McpServerState[] = [];
    for (const [name, def] of Object.entries(loaded.servers)) {
      servers.push(await this.probeServer(workspaceId, projectPath, name, def));
    }
    return { workspaceId, source: loaded.source, servers };
  }

  /**
   * User toggle. Persists intent, then applies immediately:
   * - Off => drop the connection (mid-run steps simply lose these tools).
   * - On => fresh reconnect + probe (this IS the retry after an error).
   * Returns the fresh single-server state for direct UI update.
   */
  async setServerEnabled(
    workspaceId: string,
    projectPath: string,
    serverName: string,
    enabled: boolean,
  ): Promise<McpServerState> {
    const settings = this.requireSettings();
    const loaded = await loadMcpConfig(projectPath);
    const def = loaded.servers[serverName];
    if (!def) {
      throw new McpError(
        serverName,
        `MCP server not found in ${loaded.source ?? '.mcp.json'}`,
        'MCP_SERVER_NOT_FOUND',
      );
    }
    await setMcpServerEnabled(settings, workspaceId, serverName, enabled);
    // Drop any stale connection so the new intent applies immediately.
    await this.closeServer(workspaceId, serverName);
    const state = await this.probeServer(workspaceId, projectPath, serverName, def);
    this.logger.info(
      { workspaceId, server: serverName, enabled, status: state.status },
      'mcp: server toggled',
    );
    return state;
  }

  async getSnapshot(workspaceId: string, projectPath: string): Promise<McpWorkspaceSnapshot> {
    const empty: McpWorkspaceSnapshot = {
      workspaceId,
      projectPath,
      source: null,
      servers: [],
      tools: [],
      resources: [],
      prompts: [],
      truncated: false,
    };
    if (!this.config.enabled) return empty;

    let loaded: Awaited<ReturnType<typeof loadMcpConfig>>;
    try {
      loaded = await loadMcpConfig(projectPath);
    } catch (err) {
      this.logger.warn({ err, workspaceId }, 'mcp: config load failed, continuing without MCP');
      return empty;
    }
    const names = Object.keys(loaded.servers).slice(0, this.config.maxServers);
    const truncated = Object.keys(loaded.servers).length > names.length;
    if (truncated) {
      this.logger.warn(
        { workspaceId, total: Object.keys(loaded.servers).length },
        'mcp: maxServers cap applied',
      );
    }

    const snapshot: McpWorkspaceSnapshot = {
      ...empty,
      source: loaded.source,
      servers: [],
      truncated,
    };
    for (const name of names) {
      const def = loaded.servers[name];
      if (!def) continue;
      if (!(await this.isEnabled(workspaceId, name))) continue;
      const k = this.key(workspaceId, name);
      let conn: McpConnection;
      try {
        conn = await this.getConnection(workspaceId, name, def, projectPath);
        this.lastError.delete(k);
      } catch (err) {
        this.lastError.set(k, errMessage(err));
        this.logger.warn(
          { err, workspaceId, server: name },
          'mcp: server skipped (connect failed)',
        );
        continue;
      }
      snapshot.servers.push(name);
      if (this.config.toolsEnabled || this.config.resourcesEnabled || this.config.promptsEnabled) {
        try {
          if (this.config.toolsEnabled) {
            const tools = await conn.listTools();
            const capped = tools.slice(0, this.config.maxToolsPerServer);
            for (const t of capped) snapshot.tools.push({ ...t, server: name });
            if (tools.length > capped.length) {
              this.logger.warn({ workspaceId, server: name }, 'mcp: maxToolsPerServer cap applied');
            }
          }
          if (this.config.resourcesEnabled) {
            const resources = await conn.listResources().catch(() => [] as McpResourceDef[]);
            for (const r of resources) snapshot.resources.push({ ...r, server: name });
          }
          if (this.config.promptsEnabled) {
            const prompts = await conn.listPrompts().catch(() => [] as McpPromptDef[]);
            for (const p of prompts) snapshot.prompts.push({ ...p, server: name });
          }
        } catch (err) {
          this.lastError.set(k, errMessage(err));
          this.logger.warn(
            { err, workspaceId, server: name },
            'mcp: list failed, server kept with partial defs',
          );
        }
      }
    }
    this.snapshots.set(workspaceId, { at: Date.now(), snapshot });
    this.logger.info?.(
      { workspaceId, servers: snapshot.servers, tools: snapshot.tools.length },
      'mcp: snapshot ready',
    );
    return snapshot;
  }

  /** Direct tool call used by the agent tool executor (Tools path only). */
  async callTool(
    workspaceId: string,
    projectPath: string,
    server: string,
    tool: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Awaited<ReturnType<McpConnection['callTool']>>> {
    const loaded = await loadMcpConfig(projectPath);
    const def = loaded.servers[server];
    if (!def) throw new McpError(server, 'MCP server not found', 'MCP_SERVER_NOT_FOUND');
    if (!(await this.isEnabled(workspaceId, server))) {
      throw new McpError(server, 'MCP server is disabled', 'MCP_DISABLED');
    }
    const conn = await this.getConnection(workspaceId, server, def, projectPath);
    return conn.callTool(tool, args, opts);
  }

  async readResource(
    workspaceId: string,
    projectPath: string,
    server: string,
    uri: string,
  ): Promise<string> {
    const loaded = await loadMcpConfig(projectPath);
    const def = loaded.servers[server];
    if (!def) throw new Error(`MCP server not found: ${server}`);
    const conn = await this.getConnection(workspaceId, server, def, projectPath);
    return conn.readResource(uri);
  }

  async getPrompt(
    workspaceId: string,
    projectPath: string,
    server: string,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<string> {
    const loaded = await loadMcpConfig(projectPath);
    const def = loaded.servers[server];
    if (!def) throw new Error(`MCP server not found: ${server}`);
    const conn = await this.getConnection(workspaceId, server, def, projectPath);
    return conn.getPrompt(name, args);
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    const prefix = `${workspaceId}\u0000`;
    for (const [k, conn] of [...this.connections]) {
      if (k.startsWith(prefix)) {
        this.connections.delete(k);
        this.lastError.delete(k);
        await conn.close().catch(() => {});
      }
    }
    this.snapshots.delete(workspaceId);
  }

  async closeAll(): Promise<void> {
    for (const [, conn] of [...this.connections]) {
      await conn.close().catch(() => {});
    }
    this.connections.clear();
    this.snapshots.clear();
    this.connecting.clear();
    this.lastError.clear();
  }
}
