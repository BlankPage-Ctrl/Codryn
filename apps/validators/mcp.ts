import { z } from 'zod';

/**
 * MCP client config validation (boundary).
 *
 * De-facto formats (no official file standard yet):
 * - Claude Code / Cursor / Claude Desktop: `{ "mcpServers": { ... } }`
 * - VS Code `.vscode/mcp.json`: `{ "servers": { ... } }`
 *
 * Unknown fields are preserved (passthrough) so forward-compatible
 * server entries are never stripped by normalization.
 */

const EnvMapSchema = z.record(z.string(), z.string()).default({});

const StdioRawSchema = z
  .object({
    type: z.string().optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    env: EnvMapSchema,
    cwd: z.string().trim().min(1).optional(),
  })
  .passthrough();

const HttpRawSchema = z
  .object({
    type: z.string().optional(),
    url: z.string().trim().min(1),
    headers: EnvMapSchema,
  })
  .passthrough();

const ServerRawSchema = z.union([StdioRawSchema, HttpRawSchema]);

const McpServersFileSchema = z
  .object({
    mcpServers: z.record(z.string(), ServerRawSchema).default({}),
  })
  .passthrough();

const VsCodeFileSchema = z
  .object({
    servers: z.record(z.string(), ServerRawSchema).default({}),
  })
  .passthrough();

export type McpServerRaw = z.infer<typeof ServerRawSchema>;

export interface McpStdioDef {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  extra: Record<string, unknown>;
}

export interface McpHttpDef {
  transport: 'http';
  url: string;
  headers: Record<string, string>;
  extra: Record<string, unknown>;
}

export type McpServerDef = McpStdioDef | McpHttpDef;

const KNOWN_STDIO_KEYS = new Set(['type', 'command', 'args', 'env', 'cwd']);
const KNOWN_HTTP_KEYS = new Set(['type', 'url', 'headers']);

function extraOf(raw: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) extra[k] = v;
  }
  return extra;
}

function inferTransport(raw: McpServerRaw): 'stdio' | 'http' | null {
  const t = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (t === 'stdio' || t === 'local') return 'stdio';
  if (t === 'http' || t === 'streamable-http' || t === 'sse' || t === 'remote') return 'http';
  if (t === 'ws' || t === 'websocket') return null;
  if ('command' in raw && typeof (raw as { command?: unknown }).command === 'string')
    return 'stdio';
  if ('url' in raw && typeof (raw as { url?: unknown }).url === 'string') return 'http';
  return null;
}

/**
 * Expand `${VAR}` / `${VAR:-default}` / `${workspaceFolder}` references.
 * Unknown vars without default expand to empty string (Claude Code behavior).
 */
export function expandEnvVars(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(/\$\{([^}]+)\}/g, (match, inner: string) => {
    const expr = String(inner);
    if (expr === 'workspaceFolder' || expr === 'workspaceFolderBasename') return match;
    const defIdx = expr.indexOf(':-');
    if (defIdx >= 0) {
      const name = expr.slice(0, defIdx);
      const def = expr.slice(defIdx + 2);
      const val = env[name];
      return val === undefined || val === '' ? def : val;
    }
    // `${env:NAME}` (Cursor-style) and `${input:name}` (VS Code prompt) are
    // left unresolved - the caller decides (no interactive input support).
    if (expr.startsWith('env:')) {
      return env[expr.slice(4)] ?? '';
    }
    if (expr.startsWith('input:')) return match;
    return env[expr] ?? '';
  });
}

function expandMap(map: Record<string, string>, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[k] = expandEnvVars(v, env);
  return out;
}

/** Normalize one raw server entry. Returns null for unsupported transports (ws). */
export function normalizeServerDef(
  raw: McpServerRaw,
  env: NodeJS.ProcessEnv = process.env,
): McpServerDef | null {
  const kind = inferTransport(raw);
  if (kind === null) return null;
  if (kind === 'stdio') {
    const parsed = StdioRawSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid stdio MCP server: ${parsed.error.message}`);
    const { command, args, env: envMap, cwd } = parsed.data;
    return {
      transport: 'stdio',
      command: expandEnvVars(command, env),
      args: args.map((a) => expandEnvVars(a, env)),
      env: expandMap(envMap, env),
      ...(cwd ? { cwd: expandEnvVars(cwd, env) } : {}),
      extra: extraOf(raw as Record<string, unknown>, KNOWN_STDIO_KEYS),
    };
  }
  const parsed = HttpRawSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid HTTP MCP server: ${parsed.error.message}`);
  return {
    transport: 'http',
    url: expandEnvVars(parsed.data.url, env),
    headers: expandMap(parsed.data.headers, env),
    extra: extraOf(raw as Record<string, unknown>, KNOWN_HTTP_KEYS),
  };
}

/** Parse an already-read JSON document into normalized server defs. */
export function parseMcpDocument(
  doc: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerDef> {
  if (typeof doc !== 'object' || doc === null)
    throw new Error('Invalid MCP config: top-level JSON must be an object');
  const obj = doc as Record<string, unknown>;
  const rawMap: Record<string, McpServerRaw> = {};
  if ('mcpServers' in obj) {
    const parsed = McpServersFileSchema.safeParse(doc);
    if (!parsed.success) throw new Error(`Invalid MCP config: ${parsed.error.message}`);
    Object.assign(rawMap, parsed.data.mcpServers);
  } else if ('servers' in obj) {
    const parsed = VsCodeFileSchema.safeParse(doc);
    if (!parsed.success) throw new Error(`Invalid MCP config: ${parsed.error.message}`);
    Object.assign(rawMap, parsed.data.servers);
  } else {
    return {};
  }
  const out: Record<string, McpServerDef> = {};
  for (const [name, raw] of Object.entries(rawMap)) {
    if (!name.trim()) continue;
    const def = normalizeServerDef(raw, env);
    if (def) out[name] = def;
  }
  return out;
}

// --- Delivery-boundary validators for the MCP list/toggle actions ---

export const McpServerNameSchema = z.string().trim().min(1).max(200);

export const McpListParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export function validateMcpList(params: unknown) {
  return McpListParamsSchema.parse(params);
}

export const McpSetEnabledParamsSchema = z.object({
  workspaceId: z.string().min(1),
  name: McpServerNameSchema,
  enabled: z.boolean(),
});

export function validateMcpSetEnabled(params: unknown) {
  return McpSetEnabledParamsSchema.parse(params);
}
