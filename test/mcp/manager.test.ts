import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { McpManager, DEFAULT_MCP_CONFIG } from '../../apps/mcp/manager.js';
import type { McpConnection } from '../../apps/mcp/client.js';

function projectWith(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mgr-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(config));
  return dir;
}

function fakeFactory(connections: McpConnection[]) {
  let i = 0;
  const calls: string[] = [];
  return {
    calls,
    factory: () => {
      const conn = connections[i++];
      if (!conn) throw new Error('no more fake connections');
      return conn;
    },
  };
}

function fakeConn(overrides: Partial<McpConnection> & { serverName: string }): McpConnection {
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    listResources: async () => [],
    readResource: async () => '',
    listPrompts: async () => [],
    getPrompt: async () => '',
    ...overrides,
  };
}

test('getSnapshot: aggregates tools per server, caps maxServers', async () => {
  const dir = projectWith({
    mcpServers: {
      a: { command: 'cmd-a' },
      b: { command: 'cmd-b' },
      c: { command: 'cmd-c' },
    },
  });
  const { factory } = fakeFactory([
    fakeConn({
      serverName: 'a',
      listTools: async () => [{ name: 't1', inputSchema: { type: 'object' } }],
    }),
    fakeConn({
      serverName: 'b',
      listTools: async () => [{ name: 't2', inputSchema: { type: 'object' } }],
    }),
  ]);
  const mgr = new McpManager({ ...DEFAULT_MCP_CONFIG, maxServers: 2 }, console, factory);
  const snap = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(snap.servers, ['a', 'b']);
  assert.equal(snap.tools.length, 2);
  assert.equal(snap.truncated, true);
  await mgr.closeAll();
});

test('getSnapshot: one failing server does not break others (fail-open)', async () => {
  const dir = projectWith({ mcpServers: { bad: { command: 'x' }, good: { command: 'y' } } });
  const mgr = new McpManager(
    { ...DEFAULT_MCP_CONFIG },
    console,
    (() => {
      let n = 0;
      return () => {
        n++;
        if (n === 1) {
          return fakeConn({
            serverName: 'bad',
            connect: async () => {
              throw new Error('spawn ENOENT');
            },
          });
        }
        return fakeConn({
          serverName: 'good',
          listTools: async () => [{ name: 'ok', inputSchema: { type: 'object' } }],
        });
      };
    })(),
  );
  const snap = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(snap.servers, ['good']);
  assert.equal(snap.tools.length, 1);
  await mgr.closeAll();
});

test('getSnapshot: disabled manager returns empty snapshot', async () => {
  const dir = projectWith({ mcpServers: { a: { command: 'x' } } });
  const mgr = new McpManager({ ...DEFAULT_MCP_CONFIG, enabled: false }, console, () => {
    throw new Error('factory must not be called');
  });
  const snap = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(snap.servers, []);
  await mgr.closeAll();
});

test('getSnapshot: invalid config file returns empty (fail-open)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mgr-bad-'));
  writeFileSync(join(dir, '.mcp.json'), '{broken');
  const mgr = new McpManager({ ...DEFAULT_MCP_CONFIG }, console, () => {
    throw new Error('factory must not be called');
  });
  const snap = await mgr.getSnapshot('ws1', dir);
  assert.deepEqual(snap.servers, []);
  assert.equal(snap.source, null);
  await mgr.closeAll();
});
