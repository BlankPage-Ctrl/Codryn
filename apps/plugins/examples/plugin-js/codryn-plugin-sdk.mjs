/**
 * Codryn plugin SDK - single file, no dependencies.
 *
 * The plugin contract lives in `codryn-plugin.json`. This helper reads that
 * file, reports which tools the plugin implements, and routes `tools/call`
 * to the implementations.
 * */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const MANIFEST_FILE = 'codryn-plugin.json';

function log(message) {
  console.error(`[codryn-plugin] ${message}`);
}

function readManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    log(`cannot read ${MANIFEST_FILE} in ${dir}: ${err.message}`);
    return null;
  }
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

/**
 * Register a plugin.
 *
 * `tools` maps a tool name to its implementation. Names come from
 * `codryn-plugin.json`; only the implementations live here.
 */
export function definePlugin(definition = {}) {
  const tools = definition.tools ?? {};
  const implemented = Object.keys(tools);

  let manifest = null;

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      sendError(null, -32700, 'Parse error');
      return;
    }

    const { id, method, params } = msg;

    if (id !== undefined) {
      switch (method) {
        case 'initialize': {
          const dir = params?.cwd || process.cwd();
          manifest = readManifest(dir);
          reportDrift(manifest, implemented);
          send(id, {
            manifest: {
              name: manifest?.name ?? 'Codryn plugin',
              version: manifest?.version ?? '0.0.0',
              description: manifest?.description ?? '',
              tools: implemented,
              requiresCodrynTools: [],
            },
          });
          return;
        }

        case 'tools/list': {
          send(id, { tools: implemented });
          return;
        }

        case 'tools/call': {
          const name = params?.name;
          const tool = tools[name];
          if (!tool) {
            sendError(id, -32601, `Tool ${name} not found`);
            return;
          }
          try {
            const text = await tool(params?.arguments ?? {});
            send(id, { ok: true, text: String(text) });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send(id, { ok: false, text: message, code: 'TOOL_EXECUTION_FAILED', message });
          }
          return;
        }

        case 'ping': {
          send(id, { pong: true });
          return;
        }

        case 'shutdown': {
          send(id, { shutdown: true });
          process.exit(0);
          return;
        }

        default:
          sendError(id, -32601, `Method ${method} not found`);
      }
      return;
    }
  });

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

function reportDrift(manifest, implemented) {
  const declared = Array.isArray(manifest?.tools) ? manifest.tools : [];
  if (declared.length === 0) return;

  const declaredNames = new Set(declared.map((tool) => tool.name));
  for (const name of implemented) {
    if (!declaredNames.has(name)) {
      log(`tool "${name}" is not declared in ${MANIFEST_FILE}; Codryn will not expose it.`);
    }
  }
  for (const name of declaredNames) {
    if (!implemented.includes(name)) {
      log(`tool "${name}" is declared in ${MANIFEST_FILE} but not implemented.`);
    }
  }
}
