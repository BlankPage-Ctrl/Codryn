import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PluginProcess } from '../../apps/plugins/runtime/process.js';
import { PluginHost } from '../../apps/plugins/host.js';
import { createPluginTool } from '../../apps/plugins/tool-bridge.js';
import { loadCodrynManifest } from '../../apps/plugins/native.js';
import type { PluginInternalTool } from '../../apps/plugins/runtime/types.js';

function memSettings(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getValue: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setValue: async (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

function writeManifest(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'codryn-plugin.json'), JSON.stringify(manifest));
}

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    description: 'Demo plugin',
    ...overrides,
  };
}

test('PluginProcess: spawn and initialize handshake', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-proc-'));
  try {
    const pluginScript = path.join(tmp, 'plugin.js');
    writeFileSync(
      pluginScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const tools = {
  echo: {
    name: 'echo',
    description: 'Echo back the input',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    isSensitive: false,
    destructive: false,
    async execute(args) { return 'Echo: ' + (args.text || ''); }
  }
};
const manifest = {
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'Test plugin',
  tools: Object.values(tools),
  hooks: ['beforeTool'],
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: Object.values(tools) } }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const tool = tools[msg.params.name];
    if (!tool) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }) + '\\n');
      return;
    }
    tool.execute(msg.params.arguments).then(result => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true, text: result } }) + '\\n');
    });
  } else if (msg.method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }) + '\\n');
  }
});
`,
    );

    const proc = new PluginProcess({
      id: 'demo',
      runtime: { command: 'node', args: [pluginScript] },
      workspaceId: 'ws1',
      cwd: tmp,
      timeoutMs: 5000,
      spawnTimeoutMs: 5000,
    });

    const handle = await proc.start();
    assert.equal(handle.state, 'ready');
    assert.equal(handle.internalManifest?.name, 'Test Plugin');
    assert.equal(handle.tools.length, 1);
    assert.equal(handle.hooks.length, 1);

    const pong = await proc.ping();
    assert.equal(pong, true);

    const result = await proc.callTool('echo', { text: 'hello' });
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Echo: hello');

    await proc.close();
    assert.equal(proc.handle.state, 'closed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('PluginProcess: handles process crash gracefully', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-crash-'));
  try {
    const pluginScript = path.join(tmp, 'crash.js');
    writeFileSync(
      pluginScript,
      `
process.on('message', () => {});
setTimeout(() => { process.exit(1); }, 100);
`,
    );

    const proc = new PluginProcess({
      id: 'crash',
      runtime: { command: 'node', args: [pluginScript] },
      workspaceId: 'ws1',
      cwd: tmp,
      timeoutMs: 5000,
      spawnTimeoutMs: 5000,
    });

    try {
      await proc.start();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('PluginHost: register and ensurePlugin', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-host-'));
  try {
    const pluginScript = path.join(tmp, 'plugin.js');
    writeFileSync(
      pluginScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const tools = {
  add: {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    isSensitive: false,
    destructive: false,
    async execute(args) { return 'Result: ' + (args.a + args.b); }
  }
};
const manifest = {
  name: 'Math Plugin',
  version: '1.0.0',
  description: 'Math operations',
  tools: Object.values(tools),
  hooks: [],
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: Object.values(tools) } }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const tool = tools[msg.params.name];
    if (!tool) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }) + '\\n');
      return;
    }
    tool.execute(msg.params.arguments).then(result => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true, text: result } }) + '\\n');
    });
  } else if (msg.method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }) + '\\n');
  }
});
`,
    );

    const host = new PluginHost({ timeoutMs: 5000, spawnTimeoutMs: 5000 });

    const manifest = {
      id: 'math',
      name: 'Math',
      version: '1.0.0',
      description: 'Math plugin',
      runtime: { command: 'node', args: [pluginScript] },
      hooks: { beforeTool: false, afterTool: false, beforeExecute: false, afterExecute: false },
      tools: [],
    };
    host.register('math', manifest, tmp, 'ws1');

    const handle = await host.ensurePlugin('math');
    assert.equal(handle.state, 'ready');
    assert.equal(handle.internalManifest?.name, 'Math Plugin');

    const tools = host.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, 'add');

    const result = await host.callTool('add', { a: 2, b: 3 });
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Result: 5');

    await host.closeAll();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('PluginHost: hook gating by registry manifest', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-hooks-'));
  try {
    const pluginScript = path.join(tmp, 'plugin.js');
    writeFileSync(
      pluginScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const tools = {};
const manifest = {
  name: 'Hook Test',
  version: '1.0.0',
  description: 'Hook test plugin',
  tools: [],
  hooks: ['beforeTool', 'afterTool'],
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }) + '\\n');
  } else if (msg.method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }) + '\\n');
  }
});
`,
    );

    const host = new PluginHost({ timeoutMs: 5000, spawnTimeoutMs: 5000 });

    const manifestWithHook = {
      id: 'hooked',
      name: 'Hooked',
      version: '1.0.0',
      description: 'Hooked plugin',
      runtime: { command: 'node', args: [pluginScript] },
      hooks: { beforeTool: true, afterTool: false, beforeExecute: false, afterExecute: false },
      tools: [],
    };
    host.register('hooked', manifestWithHook, tmp, 'ws1');

    const manifestNoHook = {
      id: 'unhooked',
      name: 'Unhooked',
      version: '1.0.0',
      description: 'Unhooked plugin',
      runtime: { command: 'node', args: [pluginScript] },
      hooks: { beforeTool: false, afterTool: false, beforeExecute: false, afterExecute: false },
      tools: [],
    };
    host.register('unhooked', manifestNoHook, tmp, 'ws1');

    await host.ensurePlugin('hooked');
    await host.ensurePlugin('unhooked');

    const subscribers = host.getHookSubscribers('beforeTool');
    assert.deepEqual(subscribers, ['hooked']);

    host.dispatchHook('beforeTool', {
      pluginId: 'hooked',
      tool: 'test',
      args: {},
      timestamp: Date.now(),
    });

    await host.closeAll();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('createPluginTool: creates AgentTool with namespaced name', async () => {
  const tool: PluginInternalTool = {
    name: 'scan',
    description: 'Scan for issues',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    isSensitive: false,
    destructive: false,
  };

  const mockHost = {
    dispatchHook: () => {},
    callTool: async () => ({ ok: true, text: 'Scan complete' }),
  };

  const agentTool = createPluginTool('demo', tool, {
    host: mockHost as never,
    hitl: { requestAndWait: async () => ({}) } as never,
    workspaceId: 'ws1',
    chatId: 'c1',
  });

  assert.equal(agentTool.name, 'demo__scan');
  assert.equal(agentTool.description, 'Scan for issues');
});

test('manifest: hooks schema accepts valid hook declarations', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-manifest-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, {
      ...baseManifest(),
      hooks: {
        beforeTool: true,
        afterTool: true,
        beforeExecute: false,
        afterExecute: false,
      },
    });

    const loaded = await loadCodrynManifest(dir);
    assert.ok(loaded.manifest);
    assert.equal(loaded.manifest.hooks.beforeTool, true);
    assert.equal(loaded.manifest.hooks.afterTool, true);
    assert.equal(loaded.manifest.hooks.beforeExecute, false);
    assert.equal(loaded.manifest.hooks.afterExecute, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: hooks default to false when not specified', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-manifest-default-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, baseManifest());

    const loaded = await loadCodrynManifest(dir);
    assert.ok(loaded.manifest);
    assert.equal(loaded.manifest.hooks.beforeTool, false);
    assert.equal(loaded.manifest.hooks.afterTool, false);
    assert.equal(loaded.manifest.hooks.beforeExecute, false);
    assert.equal(loaded.manifest.hooks.afterExecute, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: runtime schema accepts cwd and env', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-runtime-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, {
      ...baseManifest(),
      runtime: {
        command: 'node',
        args: ['./plugin.js'],
        cwd: '/tmp',
        env: { API_KEY: 'test' },
      },
    });

    const loaded = await loadCodrynManifest(dir);
    assert.ok(loaded.manifest);
    assert.equal(loaded.manifest.runtime?.command, 'node');
    assert.equal(loaded.manifest.runtime?.cwd, '/tmp');
    assert.equal(loaded.manifest.runtime?.env?.API_KEY, 'test');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
