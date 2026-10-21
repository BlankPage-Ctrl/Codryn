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
const HOOK_PREFIX = 'hooks/';
const DESCRIBE_METHOD = 'hooks/describe';
const CALL_TIMEOUT_MS = 5_000;

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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge so a plugin can change one field without resending the rest. */
function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function normalizeHook(hook) {
  if (typeof hook === 'function') return { mode: 'observe', handler: hook };
  return { mode: hook.mode ?? 'observe', handler: hook.handler };
}

/**
 * Register a plugin.
 *
 * `tools` maps a tool name to its implementation. `hooks` maps a hook name to
 * an observer, or to `{ mode, handler }` where mode is observe, transform or
 * veto. Names come from `codryn-plugin.json`; only the implementations live
 * here.
 */
export function definePlugin(definition = {}) {
  const tools = definition.tools ?? {};
  const rawHooks = definition.hooks ?? {};
  const hooks = {};
  const hookModes = {};
  for (const [name, hook] of Object.entries(rawHooks)) {
    const normalized = normalizeHook(hook);
    hooks[name] = normalized;
    hookModes[name] = normalized.mode;
  }
  const implemented = Object.keys(tools);

  let manifest = null;
  let nextId = 1;
  const pending = new Map();

  /** Ask Codryn for the hook catalog: payload shape, versions, writable paths. */
  function describeHooks() {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${DESCRIBE_METHOD} timed out`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: DESCRIBE_METHOD })}\n`);
    });
  }

  async function runHook(hook, params) {
    const payload = params?.payload ?? params;

    if (hook.mode === 'veto') {
      const reason = await hook.handler(payload);
      if (typeof reason === 'string' && reason.trim() !== '') {
        return { ok: true, veto: { reason } };
      }
      return { ok: true };
    }

    if (hook.mode === 'transform') {
      const patch = await hook.handler(payload);
      if (patch === undefined || patch === null) return { ok: true };
      return { ok: true, payload: deepMerge(payload, patch) };
    }

    await hook.handler(payload);
    return { ok: true };
  }

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

    if (id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = pending.get(id);
      if (waiter) {
        pending.delete(id);
        if (msg.error) waiter.reject(new Error(msg.error.message ?? 'request failed'));
        else waiter.resolve(msg.result);
      }
      return;
    }

    if (typeof method === 'string' && method.startsWith(HOOK_PREFIX)) {
      const hookName = method.slice(HOOK_PREFIX.length);
      const hook = hooks[hookName];
      if (!hook) {
        if (id !== undefined) send(id, { ok: true });
        return;
      }
      try {
        const result = await runHook(hook, params);
        if (id !== undefined) send(id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`hook ${hookName} failed: ${message}`);
        if (id !== undefined) send(id, { ok: false, reason: message });
      }
      return;
    }

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
              hooks: Object.keys(hooks),
              hookModes,
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

  return { describeHooks };
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
