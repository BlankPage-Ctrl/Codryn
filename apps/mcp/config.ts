import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseMcpDocument, type McpServerDef } from '../validators/mcp.js';

export interface McpConfigSource {
  servers: Record<string, McpServerDef>;
  /** Absolute path of the file that was loaded, or null when none exists. */
  source: string | null;
  /** Server names skipped because their transport is unsupported. */
  skipped: string[];
}

const PROJECT_FILE = '.mcp.json';
const VSCODE_FILE = join('.vscode', 'mcp.json');

/**
 * Load MCP server definitions for a workspace project.
 *
 * Lookup order: `<projectPath>/.mcp.json` -> `<projectPath>/.vscode/mcp.json`
 * -> empty. Missing files are NOT an error. Invalid JSON / schema IS an error
 * (surfaced to logs, never thrown into the chat path - see manager).
 *
 * Security: `cwd` is locked to `projectPath` or a subdirectory. Anything else
 * falls back to `projectPath`. `${workspaceFolder}` placeholders resolve here
 * because validators intentionally leave them untouched.
 */
export async function loadMcpConfig(projectPath: string): Promise<McpConfigSource> {
  const candidates = [join(projectPath, PROJECT_FILE), join(projectPath, VSCODE_FILE)];
  for (const file of candidates) {
    let raw: string;
    try {
      raw = await readFile(file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid MCP config ${file}: not valid JSON (${(err as Error).message})`, {
        cause: err,
      });
    }
    let servers: Record<string, McpServerDef>;
    try {
      servers = parseMcpDocument(doc);
    } catch (err) {
      throw new Error(`Invalid MCP config ${file}: ${(err as Error).message}`, { cause: err });
    }
    const skipped: string[] = [];
    for (const def of Object.values(servers)) {
      if (def.transport === 'stdio') {
        def.cwd = resolveServerCwd(projectPath, def.cwd);
      }
    }
    void skipped;
    return { servers, source: file, skipped };
  }
  return { servers: {}, source: null, skipped: [] };
}

function resolveServerCwd(projectPath: string, cwd: string | undefined): string {
  const root = resolve(projectPath);
  if (!cwd || cwd.includes('${workspaceFolder')) return root;
  const abs = isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd);
  if (abs === root || abs.startsWith(root + '/')) return abs;
  return root;
}
