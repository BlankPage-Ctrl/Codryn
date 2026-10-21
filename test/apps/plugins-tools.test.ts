import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PluginHost } from '../../apps/plugins/host.js';
import {
  callPluginTool,
  findPluginForTool,
  listPluginTools,
} from '../../apps/plugins/tools/registry.js';
import { createPluginTool } from '../../apps/plugins/tools/bridge.js';
import type { PluginToolContract } from '../../apps/plugins/contract.js';
import type { CodrynPluginManifest } from '../../apps/plugins/native.js';

const PLUGIN_SCRIPT = `
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
  hooks: [],
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
  } else if (msg.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { shutdown: true } }) + '\\n');
    process.exit(0);
  }
});
`;

function mathManifest(): CodrynPluginManifest {
  return {
    id: 'math',
    name: 'Math',
    version: '1.0.0',
    description: 'Math plugin',
    permissions: { shell: false, network: false, sensitive: false },
    lifecycle: {},
    limits: { maxSkills: 40, maxSkillBytes: 1_000_000 },
    runtime: { command: 'node', args: ['./plugin.js'], env: {} },
    hooks: {
      beforeTool: false,
      afterTool: false,
      beforeExecute: false,
      afterExecute: false,
    },
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
  } as CodrynPluginManifest;
}

async function spawnMathPlugin(): Promise<{ host: PluginHost; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'plugin-tools-'));
  writeFileSync(path.join(dir, 'plugin.js'), PLUGIN_SCRIPT);
  const host = new PluginHost({ timeoutMs: 5_000, spawnTimeoutMs: 5_000 });
  host.register('math', mathManifest(), dir, 'ws1');
  await host.ensurePlugin('math');
  return { host, dir };
}

test('tools: a declared tool is found by its bare name', async () => {
  const { host, dir } = await spawnMathPlugin();
  try {
    assert.equal(findPluginForTool(host, 'add')?.id, 'math');
    assert.equal(findPluginForTool(host, 'missing'), null);
    assert.deepEqual(listPluginTools(host), ['add']);
  } finally {
    await host.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: a namespaced call reaches the plugin', async () => {
  const { host, dir } = await spawnMathPlugin();
  try {
    const result = await callPluginTool(host, 'math__add', { a: 2, b: 3 });
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Result: 5');
  } finally {
    await host.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: a call to an unknown plugin is reported, not thrown', async () => {
  const { host, dir } = await spawnMathPlugin();
  try {
    const result = await callPluginTool(host, 'ghost__missing', {});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TOOL_NOT_FOUND');
  } finally {
    await host.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: an error from the plugin surfaces as a rejected call', async () => {
  const { host, dir } = await spawnMathPlugin();
  try {
    await assert.rejects(() => callPluginTool(host, 'math__missing', {}));
  } finally {
    await host.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: the bridge exposes the tool under its namespaced name', async () => {
  const tool: PluginToolContract = {
    name: 'scan',
    description: 'Scan for issues',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    isSensitive: false,
    destructive: false,
  };

  const mockHost = {
    getPlugin: () => null,
    isPluginReady: () => false,
    requestPlugin: async () => ({ ok: true, text: 'Scan complete' }),
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
