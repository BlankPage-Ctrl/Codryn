import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpHttpDef, McpServerDef, McpStdioDef } from '../validators/mcp.js';
import type { Logger } from '../shared/types.js';
import { BACKEND_NAME, getVersion } from '../shared/version.js';

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export class McpError extends Error {
  constructor(
    public readonly server: string,
    message: string,
    public readonly code = 'MCP_ERROR',
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpConnectionOptions {
  timeoutMs: number;
  logger?: Logger;
}

export interface McpConnection {
  readonly serverName: string;
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<McpToolDef[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpCallResult>;
  listResources(): Promise<McpResourceDef[]>;
  readResource(uri: string, opts?: { signal?: AbortSignal }): Promise<string>;
  listPrompts(): Promise<McpPromptDef[]>;
  getPrompt(name: string, args?: Record<string, unknown>): Promise<string>;
}

/**
 * Real MCP connection backed by the official TypeScript SDK.
 * One instance per (workspace, server). Not thread-safe for concurrent
 * connect() - manager serializes it.
 */
export class SdkMcpConnection implements McpConnection {
  private client: Client | null = null;
  private transport: { close?: () => Promise<void> } | null = null;
  private connected = false;

  constructor(
    public readonly serverName: string,
    private readonly def: McpServerDef,
    private readonly projectPath: string,
    private readonly options: McpConnectionOptions,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    const logger = this.options.logger;
    try {
      if (this.def.transport === 'stdio') {
        this.transport = new StdioClientTransport({
          command: (this.def as McpStdioDef).command,
          args: (this.def as McpStdioDef).args,
          env: { ...(process.env as Record<string, string>), ...(this.def as McpStdioDef).env },
          cwd: (this.def as McpStdioDef).cwd ?? this.projectPath,
          stderr: 'ignore',
        }) as unknown as { close?: () => Promise<void> };
      } else {
        const http = this.def as McpHttpDef;
        this.transport = new StreamableHTTPClientTransport(new URL(http.url), {
          requestInit: { headers: http.headers },
        }) as unknown as { close?: () => Promise<void> };
      }
      const client = new Client(
        { name: BACKEND_NAME, version: getVersion() },
        { capabilities: { elicitation: { form: {} } } },
      );
      await client.connect(this.transport as never);
      this.client = client;
      this.connected = true;
    } catch (err) {
      logger?.warn?.({ err, server: this.serverName }, 'mcp: connect failed');
      await this.close().catch(() => {});
      throw new McpError(
        this.serverName,
        `Connect failed: ${(err as Error).message}`,
        'MCP_CONNECT_FAILED',
      );
    }
  }

  private requireClient(): Client {
    if (!this.client || !this.connected) {
      throw new McpError(this.serverName, 'Not connected', 'MCP_NOT_CONNECTED');
    }
    return this.client;
  }

  async close(): Promise<void> {
    this.connected = false;
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.close();
      } catch {
        // best-effort
      }
    }
    this.transport = null;
  }

  async listTools(): Promise<McpToolDef[]> {
    const client = this.requireClient();
    const out: McpToolDef[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = (await withTimeout(
        client.listTools(cursor ? { cursor } : undefined, undefined),
        this.options.timeoutMs,
        this.serverName,
        'tools/list',
      )) as { tools: McpToolDef[]; nextCursor?: string };
      out.push(...(page.tools ?? []));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpCallResult> {
    const client = this.requireClient();
    if (opts?.signal?.aborted) {
      throw new McpError(this.serverName, 'Call aborted', 'MCP_ABORTED');
    }
    try {
      const res = (await withTimeout(
        client.callTool({ name, arguments: args }, undefined, {
          ...(opts?.signal ? { signal: opts.signal } : {}),
          timeout: opts?.timeoutMs ?? this.options.timeoutMs,
        }),
        (opts?.timeoutMs ?? this.options.timeoutMs) + 5_000,
        this.serverName,
        `tools/call ${name}`,
      )) as McpCallResult;
      return {
        content: Array.isArray(res.content) ? (res.content as McpContentBlock[]) : [],
        ...(res.isError !== undefined ? { isError: res.isError } : {}),
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(
        this.serverName,
        `tools/call ${name} failed: ${(err as Error).message}`,
        'MCP_CALL_FAILED',
      );
    }
  }

  async listResources(): Promise<McpResourceDef[]> {
    const client = this.requireClient();
    const out: McpResourceDef[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = (await withTimeout(
        client.listResources(cursor ? { cursor } : undefined, undefined),
        this.options.timeoutMs,
        this.serverName,
        'resources/list',
      )) as { resources: McpResourceDef[]; nextCursor?: string };
      out.push(...(page.resources ?? []));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  }

  async readResource(uri: string, opts?: { signal?: AbortSignal }): Promise<string> {
    const client = this.requireClient();
    const res = (await withTimeout(
      client.readResource({ uri }, undefined),
      this.options.timeoutMs,
      this.serverName,
      'resources/read',
    )) as { contents: Array<{ text?: string; blob?: string; mimeType?: string }> };
    const parts: string[] = [];
    for (const c of res.contents ?? []) {
      if (typeof c.text === 'string') parts.push(c.text);
      else if (typeof c.blob === 'string')
        parts.push(`(binary blob, mime=${c.mimeType ?? 'unknown'}, base64 omitted)`);
    }
    void opts;
    return parts.join('\n');
  }

  async listPrompts(): Promise<McpPromptDef[]> {
    const client = this.requireClient();
    const out: McpPromptDef[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = (await withTimeout(
        client.listPrompts(cursor ? { cursor } : undefined, undefined),
        this.options.timeoutMs,
        this.serverName,
        'prompts/list',
      )) as { prompts: McpPromptDef[]; nextCursor?: string };
      out.push(...(page.prompts ?? []));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<string> {
    const client = this.requireClient();
    const res = (await withTimeout(
      client.getPrompt(
        { name, ...(args ? { arguments: args as Record<string, string> } : {}) },
        undefined,
      ),
      this.options.timeoutMs,
      this.serverName,
      'prompts/get',
    )) as { messages: Array<{ role: string; content: unknown }> };
    return (res.messages ?? [])
      .map(
        (m) =>
          `**${m.role}**: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
      )
      .join('\n\n');
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  server: string,
  op: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new McpError(server, `${op} timed out after ${ms}ms`, 'MCP_TIMEOUT')),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
