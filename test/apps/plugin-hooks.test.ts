import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HookBus, type HookTransport } from '../../apps/plugins/hooks/bus.js';
import type { HookTarget, HookMode } from '../../apps/plugins/hooks/contracts.js';
import {
  createHookTransport,
  registerHookRequestHandler,
} from '../../apps/plugins/hooks/transport.js';
import { resolveHookTargets } from '../../apps/plugins/hooks/subscriptions.js';
import { PluginHost } from '../../apps/plugins/host.js';
import { diffPayload } from '../../apps/plugins/hooks/diff.js';
import { mergeHookWrites } from '../../apps/plugins/hooks/merge.js';
import { hookContract, resolveHookSubscription } from '../../apps/plugins/hooks/contracts.js';
import type { BeforeToolPayload } from '../../apps/plugins/hooks/protocol.js';
import type { CodrynPluginManifest } from '../../apps/plugins/native.js';

interface FakePlugin {
  target: HookTarget;
  reply?: unknown;
  delayMs?: number;
  seen: BeforeToolPayload[];
}

function fakeTransport(plugins: FakePlugin[]): HookTransport {
  return {
    targets: () => plugins.map((plugin) => plugin.target),
    notify: async (pluginId, _hookName, params) => {
      const plugin = plugins.find((entry) => entry.target.pluginId === pluginId);
      plugin?.seen.push(params.payload as BeforeToolPayload);
    },
    request: async (pluginId, _hookName, params) => {
      const plugin = plugins.find((entry) => entry.target.pluginId === pluginId);
      if (!plugin) throw new Error(`unknown plugin ${pluginId}`);
      plugin.seen.push(params.payload as BeforeToolPayload);
      if (plugin.delayMs) await new Promise((r) => setTimeout(r, plugin.delayMs));
      return plugin.reply;
    },
  };
}

function target(pluginId: string, mode: HookMode, priority = 100): HookTarget {
  return { pluginId, mode, stage: 'default', priority };
}

function toolPayload(args: Record<string, unknown>): BeforeToolPayload {
  return {
    pluginId: 'demo',
    tool: 'run_shell',
    args,
    toolCallId: 'call-1',
    timestamp: 1_000,
  };
}

test('diff: only the writable roots are considered', () => {
  const changes = diffPayload(
    { args: { command: 'ls' }, tool: 'run_shell' },
    { args: { command: 'ls -la' }, tool: 'other' },
    ['args'],
  );
  assert.deepEqual(changes, [{ path: '/args/command', op: 'set', value: 'ls -la' }]);
});

test('diff: nested objects and arrays are compared leaf by leaf', () => {
  const changes = diffPayload(
    { args: { items: ['a', 'b'], nested: { keep: 1 } } },
    { args: { items: ['a', 'c'], nested: { keep: 1 } } },
    ['args'],
  );
  assert.deepEqual(changes, [{ path: '/args/items/1', op: 'set', value: 'c' }]);
});

test('diff: a key the plugin dropped is a removal', () => {
  const changes = diffPayload({ args: { a: 1, b: 2 } }, { args: { a: 1 } }, ['args']);
  assert.deepEqual(changes, [{ path: '/args/b', op: 'remove' }]);
});

test('merge: writes on different paths all survive', () => {
  const merged = mergeHookWrites(
    { args: { command: 'ls', cwd: '/tmp' } },
    [
      { pluginId: 'a', changes: [{ path: '/args/command', op: 'set', value: 'pwd' }] },
      { pluginId: 'b', changes: [{ path: '/args/cwd', op: 'set', value: '/' }] },
    ],
    'reject',
    () => 100,
  );
  assert.deepEqual(merged.payload, { args: { command: 'pwd', cwd: '/' } });
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.applied.length, 2);
});

test('merge: two plugins on one path conflict and the original is kept', () => {
  const merged = mergeHookWrites(
    { args: { command: 'ls' } },
    [
      { pluginId: 'a', changes: [{ path: '/args/command', op: 'set', value: 'pwd' }] },
      { pluginId: 'b', changes: [{ path: '/args/command', op: 'set', value: 'rm' }] },
    ],
    'reject',
    () => 100,
  );
  assert.deepEqual(merged.payload, { args: { command: 'ls' } });
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.conflicts[0].pluginIds, ['a', 'b']);
});

test('merge: the priority policy lets the lowest number win', () => {
  const merged = mergeHookWrites(
    { args: { command: 'ls' } },
    [
      { pluginId: 'a', changes: [{ path: '/args/command', op: 'set', value: 'pwd' }] },
      { pluginId: 'b', changes: [{ path: '/args/command', op: 'set', value: 'rm' }] },
    ],
    'priority',
    (pluginId) => (pluginId === 'b' ? 10 : 100),
  );
  assert.deepEqual(merged.payload, { args: { command: 'rm' } });
  assert.deepEqual(merged.applied, [{ pluginId: 'b', paths: ['/args/command'] }]);
});

test('merge: a path and its child count as one conflict', () => {
  const merged = mergeHookWrites(
    { args: { nested: { a: 1 } } },
    [
      { pluginId: 'a', changes: [{ path: '/args/nested', op: 'set', value: { b: 2 } }] },
      { pluginId: 'b', changes: [{ path: '/args/nested/a', op: 'set', value: 9 }] },
    ],
    'reject',
    () => 100,
  );
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.payload, { args: { nested: { a: 1 } } });
});

test('bus: an observer is notified and the payload is unchanged', async () => {
  const observer: FakePlugin = { target: target('watcher', 'observe'), seen: [] };
  const bus = new HookBus({ transport: fakeTransport([observer]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.equal(outcome.applied.length, 0);
  assert.deepEqual(outcome.payload.args, { command: 'ls' });
  assert.equal(observer.seen.length, 1);
});

test('bus: a transform hook rewrites the payload', async () => {
  const writer: FakePlugin = {
    target: target('sanitizer', 'transform'),
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'ls --safe' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const bus = new HookBus({ transport: fakeTransport([writer]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.deepEqual(outcome.payload.args, { command: 'ls --safe' });
  assert.deepEqual(outcome.applied, [{ pluginId: 'sanitizer', paths: ['/args/command'] }]);
});

test('bus: a write outside the writable scope is ignored', async () => {
  const writer: FakePlugin = {
    target: target('sneaky', 'transform'),
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'other_tool',
        args: { command: 'ls' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const bus = new HookBus({ transport: fakeTransport([writer]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.equal(outcome.applied.length, 0);
  assert.deepEqual(outcome.payload.args, { command: 'ls' });
});

test('bus: a reply that breaks the contract is rejected', async () => {
  const writer: FakePlugin = {
    target: target('broken', 'transform'),
    seen: [],
    reply: { ok: true, payload: { args: { command: 'rm -rf /' } } },
  };
  const bus = new HookBus({ transport: fakeTransport([writer]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.errors.length, 1);
  assert.match(outcome.errors[0].message, /contract/);
  assert.deepEqual(outcome.payload.args, { command: 'ls' });
});

test('bus: every writer sees the same snapshot', async () => {
  const first: FakePlugin = {
    target: target('a', 'transform'),
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'from-a' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const second: FakePlugin = {
    target: target('b', 'transform'),
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'from-b', cwd: '/tmp' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const bus = new HookBus({ transport: fakeTransport([first, second]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));

  assert.deepEqual(first.seen[0].args, { command: 'ls' });
  assert.deepEqual(second.seen[0].args, { command: 'ls' });
  assert.equal(outcome.conflicts.length, 1);
  assert.deepEqual(outcome.payload.args, { command: 'ls', cwd: '/tmp' });
});

test('bus: a writer that times out does not stop the others', async () => {
  const slow: FakePlugin = {
    target: target('slow', 'transform'),
    seen: [],
    delayMs: 200,
    reply: { ok: true, payload: { pluginId: 'demo', tool: 'run_shell', args: {}, timestamp: 1 } },
  };
  const quick: FakePlugin = {
    target: target('quick', 'transform'),
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'from-quick' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const bus = new HookBus({ transport: fakeTransport([slow, quick]), timeoutMs: 50 });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.equal(outcome.errors.length, 1);
  assert.deepEqual(outcome.payload.args, { command: 'from-quick' });
});

test('bus: a veto blocks the operation', async () => {
  const vetoer: FakePlugin = {
    target: target('guard', 'veto'),
    seen: [],
    reply: { ok: true, veto: { reason: 'command not allowed' } },
  };
  const writer: FakePlugin = {
    target: target('writer', 'transform'),
    seen: [],
    reply: { ok: true, payload: { pluginId: 'demo', tool: 'run_shell', args: {}, timestamp: 1 } },
  };
  const bus = new HookBus({ transport: fakeTransport([vetoer, writer]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.blockReason, 'command not allowed');
  assert.equal(writer.seen.length, 0);
});

test('contract: a mode the hook does not allow is downgraded', () => {
  const contract = hookContract('afterTool');
  const subscription = resolveHookSubscription({ mode: 'transform', priority: 10 }, contract);
  assert.equal(subscription.mode, 'observe');
  assert.match(subscription.notice ?? '', /not allowed/);
});

test('contract: an unknown stage falls back to the default stage', () => {
  const contract = hookContract('beforeTool');
  const subscription = resolveHookSubscription(
    { mode: 'transform', stage: 'nowhere', priority: 10 },
    contract,
  );
  assert.equal(subscription.stage, 'default');
  assert.match(subscription.notice ?? '', /stage/);
});

test('contract: a declared stage is kept', () => {
  const contract = hookContract('beforeTool');
  const subscription = resolveHookSubscription(
    { mode: 'transform', stage: 'sanitize', priority: 10 },
    contract,
  );
  assert.equal(subscription.stage, 'sanitize');
  assert.equal(subscription.notice, null);
});

test('contract: the legacy boolean form means observe', () => {
  const contract = hookContract('beforeTool');
  const subscription = resolveHookSubscription(true, contract);
  assert.equal(subscription.subscribed, true);
  assert.equal(subscription.mode, 'observe');
  assert.equal(resolveHookSubscription(false, contract).subscribed, false);
});

test('bus: a later stage sees what the earlier stage wrote', async () => {
  const sanitizer: FakePlugin = {
    target: { ...target('sanitizer', 'transform'), stage: 'sanitize' },
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'ls --safe' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const enricher: FakePlugin = {
    target: { ...target('enricher', 'transform'), stage: 'enrich' },
    seen: [],
    reply: {
      ok: true,
      payload: {
        pluginId: 'demo',
        tool: 'run_shell',
        args: { command: 'ls --safe', cwd: '/tmp' },
        toolCallId: 'call-1',
        timestamp: 1_000,
      },
    },
  };
  const bus = new HookBus({ transport: fakeTransport([sanitizer, enricher]) });
  const outcome = await bus.push('beforeTool', toolPayload({ command: 'ls' }));

  assert.deepEqual(sanitizer.seen[0].args, { command: 'ls' });
  assert.deepEqual(enricher.seen[0].args, { command: 'ls --safe' });
  assert.deepEqual(outcome.payload.args, { command: 'ls --safe', cwd: '/tmp' });
});

function hookManifest(hooks: Record<string, unknown>): CodrynPluginManifest {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    description: 'Demo plugin',
    permissions: { shell: false, network: false, sensitive: false },
    lifecycle: {},
    limits: { maxSkills: 40, maxSkillBytes: 1_000_000 },
    tools: [],
    runtime: { command: 'node', args: ['./plugin.js'], env: {} },
    hooks: {
      beforeTool: false,
      afterTool: false,
      beforeExecute: false,
      afterExecute: false,
      ...hooks,
    },
  } as CodrynPluginManifest;
}

const REWRITING_PLUGIN = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    const manifest = { name: 'Rewriter', version: '1.0.0', description: 'd', tools: [], hooks: ['beforeTool'], requiresCodrynTools: [] };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
    return;
  }
  if (msg.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { shutdown: true } }) + '\\n');
    process.exit(0);
    return;
  }
  if (msg.method === 'hooks/beforeTool' && msg.id !== undefined) {
    const payload = msg.params.payload;
    const next = { ...payload, args: { ...payload.args, command: 'rewritten' } };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true, payload: next } }) + '\\n');
  }
});
`;

test('e2e: a plugin process rewrites the tool arguments', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-hook-e2e-'));
  try {
    writeFileSync(path.join(tmp, 'plugin.js'), REWRITING_PLUGIN);
    const host = new PluginHost({ timeoutMs: 5_000, spawnTimeoutMs: 5_000 });
    host.register('rewriter', hookManifest({ beforeTool: { mode: 'transform' } }), tmp, 'ws1');
    await host.ensurePlugin('rewriter');

    const bus = new HookBus({ transport: createHookTransport(host) });
    const outcome = await bus.push('beforeTool', toolPayload({ command: 'original' }));

    assert.deepEqual(outcome.payload.args, { command: 'rewritten' });
    assert.deepEqual(outcome.applied, [{ pluginId: 'rewriter', paths: ['/args/command'] }]);

    await host.closeAll();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

const LOGGING_PLUGIN = `
const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const manifest = {
  name: 'Hook Test',
  version: '1.0.0',
  description: 'Hook test plugin',
  tools: [],
  hooks: [],
  requiresCodrynTools: []
};
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
  } else if (msg.method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }) + '\\n');
  } else if (msg.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { shutdown: true } }) + '\\n');
    process.exit(0);
  } else if (msg.method === 'hooks/beforeTool') {
    fs.appendFileSync(${JSON.stringify('__HOOK_LOG__')}, 'beforeTool ' + msg.params.payload.pluginId + '\\n');
  }
});
`;

test('e2e: only the plugins that declared the hook receive it', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-hooks-'));
  try {
    const hookLog = path.join(tmp, 'hooks.log');
    writeFileSync(path.join(tmp, 'plugin.js'), LOGGING_PLUGIN.replace('__HOOK_LOG__', hookLog));

    const host = new PluginHost({ timeoutMs: 5_000, spawnTimeoutMs: 5_000 });
    host.register('hooked', hookManifest({ beforeTool: true }), tmp, 'ws1');
    host.register('unhooked', hookManifest({}), tmp, 'ws1');
    await host.ensurePlugin('hooked');
    await host.ensurePlugin('unhooked');

    const targets = resolveHookTargets(host, 'beforeTool');
    assert.deepEqual(
      targets.map((entry) => entry.pluginId),
      ['hooked'],
    );

    const bus = new HookBus({ transport: createHookTransport(host) });
    await bus.push('beforeTool', toolPayload({}));

    // The manifest decides which hooks are sent, not the plugin report.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(readFileSync(hookLog, 'utf8').trim(), 'beforeTool demo');

    await host.closeAll();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('e2e: a plugin can ask Codryn for the hook contract', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-hook-describe-'));
  try {
    const answer = path.join(tmp, 'describe.json');
    writeFileSync(
      path.join(tmp, 'plugin.js'),
      `
const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    const manifest = { name: 'Asker', version: '1.0.0', description: 'd', tools: [], hooks: [], requiresCodrynTools: [] };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { manifest } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'hooks/describe' }) + '\\n');
    return;
  }
  if (msg.id === 99) {
    fs.writeFileSync(${JSON.stringify(answer)}, JSON.stringify(msg.result));
    return;
  }
  if (msg.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { shutdown: true } }) + '\\n');
    process.exit(0);
  }
});
`,
    );
    const host = new PluginHost({ timeoutMs: 5_000, spawnTimeoutMs: 5_000 });
    registerHookRequestHandler(host);
    host.register('asker', hookManifest({}), tmp, 'ws1');
    await host.ensurePlugin('asker');

    await new Promise((r) => setTimeout(r, 300));
    const described = JSON.parse(readFileSync(answer, 'utf8'));
    const beforeTool = described.hooks.find(
      (entry: { name: string }) => entry.name === 'beforeTool',
    );
    assert.deepEqual(beforeTool.writable, ['args']);
    assert.ok(beforeTool.payload.properties.args);

    await host.closeAll();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
