import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DEFAULT_MCP_CONFIG, McpManager } from '../../apps/mcp/manager.js';
import { isMcpServerEnabled, mcpServerKey, setMcpServerEnabled } from '../../apps/mcp/settings.js';
import { McpError, type McpConnection } from '../../apps/mcp/client.js';

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

function fakeConn(overrides: Partial<McpConnection> & { serverName: string }): McpConnection {
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => [{ name: 't', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => [],
    readResource: async () => '',
    listPrompts: async () => [],
    getPrompt: async () => '',
    ...overrides,
  };
}

function projectWith(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-toggle-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(config));
  return dir;
}

const CONFIG = { mcpServers: { good: { command: 'cmd-good' }, bad: { command: 'cmd-bad' } } };

function managerWith(
  settings: ReturnType<typeof memSettings>,
  factory: () => McpConnection,
): McpManager {
  return new McpManager({ ...DEFAULT_MCP_CONFIG }, console, factory, settings);
}

test('settings: key format + default ON + roundtrip', async () => {
  assert.equal(mcpServerKey('ws1', 'default-drv'), 'workspace:ws1:mcp:default-drv');
  const s = memSettings();
  assert.equal(await isMcpServerEnabled(s, 'ws1', 'default-drv'), true);
  await setMcpServerEnabled(s, 'ws1', 'default-drv', false);
  assert.equal(await isMcpServerEnabled(s, 'ws1', 'default-drv'), false);
  await setMcpServerEnabled(s, 'ws1', 'default-drv', true);
  assert.equal(await isMcpServerEnabled(s, 'ws1', 'default-drv'), true);
});

test('getServerStates: per-server error slot, no throw', async () => {
  const dir = projectWith(CONFIG);
  const s = memSettings();
  let n = 0;
  const mgr = managerWith(s, () => {
    n++;
    return n === 1
      ? fakeConn({ serverName: 'good' })
      : fakeConn({
          serverName: 'bad',
          connect: async () => {
            throw new Error('spawn ENOENT');
          },
        });
  });
  const res = await mgr.getServerStates('ws1', dir);
  assert.equal(res.servers.length, 2);
  const good = res.servers.find((x) => x.name === 'good')!;
  const bad = res.servers.find((x) => x.name === 'bad')!;
  assert.equal(good.status, 'ready');
  assert.equal(good.tools, 1);
  assert.equal(good.error, null);
  assert.equal(bad.status, 'error');
  assert.ok(bad.error?.includes('ENOENT'));
  await mgr.closeAll();
});

test('setServerEnabled(false): persists, closes, snapshot skips', async () => {
  const dir = projectWith(CONFIG);
  const s = memSettings();
  let closed = 0;
  const mgr = managerWith(s, () =>
    fakeConn({
      serverName: 'x',
      close: async () => {
        closed++;
      },
    }),
  );
  // Warm up a connection first via snapshot.
  const before = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(before.servers.sort(), ['bad', 'good']);

  const state = await mgr.setServerEnabled('ws1', dir, 'good', false);
  assert.equal(state.enabled, false);
  assert.equal(state.status, 'disabled');
  assert.equal(s.store.get('workspace:ws1:mcp:good'), 'false');
  assert.ok(closed >= 1);

  const after = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(after.servers, ['bad']);

  // Disabled server cannot be tool-called (immediate effect).
  await assert.rejects(() => mgr.callTool('ws1', dir, 'good', 't', {}), /disabled/i);
  await mgr.closeAll();
});

test('setServerEnabled(true) after error: reconnects (retry)', async () => {
  const dir = projectWith(CONFIG);
  const s = memSettings();
  let fail = true;
  const mgr = managerWith(s, () =>
    fail
      ? fakeConn({
          serverName: 'good',
          connect: async () => {
            throw new Error('flaky');
          },
        })
      : fakeConn({ serverName: 'good' }),
  );
  await mgr.setServerEnabled('ws1', dir, 'good', false);
  fail = false;
  const retried = await mgr.setServerEnabled('ws1', dir, 'good', true);
  assert.equal(retried.status, 'ready');
  assert.equal(retried.error, null);
  assert.equal(s.store.get('workspace:ws1:mcp:good'), 'true');
  await mgr.closeAll();
});

test('setServerEnabled: unknown server throws, writes nothing', async () => {
  const dir = projectWith(CONFIG);
  const s = memSettings();
  const mgr = managerWith(s, () => fakeConn({ serverName: 'x' }));
  await assert.rejects(
    () => mgr.setServerEnabled('ws1', dir, 'nope', true),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      assert.equal((err as McpError).code, 'MCP_SERVER_NOT_FOUND');
      return true;
    },
  );
  assert.equal(s.store.size, 0);
  await mgr.closeAll();
});
