import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PluginProcess } from '../../apps/plugins/runtime/process.js';
import { PluginHost } from '../../apps/plugins/host.js';
import { loadCodrynManifest } from '../../apps/plugins/native.js';
import type { CodrynPluginManifest } from '../../apps/plugins/native.js';

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

function registryManifest(partial: {
  id: string;
  name: string;
  version: string;
  description: string;
  runtime?: { command: string; args?: string[] };
  tools?: CodrynPluginManifest['tools'];
}): CodrynPluginManifest {
  const { runtime, ...rest } = partial;
  return {
    permissions: { shell: false, network: false, sensitive: false },
    lifecycle: {},
    limits: { maxSkills: 40, maxSkillBytes: 1_000_000 },
    tools: [],
    ...rest,
    ...(runtime ? { runtime: { args: [], env: {}, ...runtime } } : {}),
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
  tools: Object.keys(tools),
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: Object.keys(tools) } }) + '\\n');
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
    assert.equal(handle.tools[0], 'echo');

    const pong = await proc.ping();
    assert.equal(pong, true);

    const result = (await proc.request('tools/call', {
      name: 'echo',
      arguments: { text: 'hello' },
    })) as { ok: boolean; text: string };
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
  tools: Object.keys(tools),
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: Object.keys(tools) } }) + '\\n');
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

    const manifest = registryManifest({
      id: 'math',
      name: 'Math',
      version: '1.0.0',
      description: 'Math plugin',
      runtime: { command: 'node', args: [pluginScript] },
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          sensitive: false,
          destructive: false,
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
          },
        },
      ],
    });
    host.register('math', manifest, tmp, 'ws1');

    const handle = await host.ensurePlugin('math');
    assert.equal(handle.state, 'ready');
    assert.equal(handle.internalManifest?.name, 'Math Plugin');
    assert.equal(host.isPluginReady('math'), true);
    assert.deepEqual(host.getRuntimeManifest('math')?.tools, ['add']);

    await host.closeAll();
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
