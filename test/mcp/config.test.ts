import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { loadMcpConfig } from '../../apps/mcp/config.js';
import { expandEnvVars, normalizeServerDef, parseMcpDocument } from '../../apps/validators/mcp.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

test('parseMcpDocument: claude-style mcpServers with stdio + http', () => {
  const out = parseMcpDocument(
    {
      mcpServers: {
        fs: { command: 'npx', args: ['-y', 'srv'], env: { A: '1' } },
        remote: { type: 'http', url: 'https://example.com/mcp', headers: { H: 'x' } },
      },
    },
    {},
  );
  assert.equal(out.fs?.transport, 'stdio');
  assert.equal(out.remote?.transport, 'http');
});

test('parseMcpDocument: vscode servers key + sse treated as http, ws skipped', () => {
  const out = parseMcpDocument(
    {
      servers: {
        legacy: { type: 'sse', url: 'https://example.com/sse' },
        sock: { type: 'ws', url: 'ws://example.com' },
      },
    },
    {},
  );
  assert.equal(out.legacy?.transport, 'http');
  assert.ok(!('sock' in out));
});

test('parseMcpDocument: type defaults by shape', () => {
  const out = parseMcpDocument({ mcpServers: { a: { command: 'cmd' } } }, {});
  assert.equal(out.a?.transport, 'stdio');
});

test('expandEnvVars: ${VAR} and ${VAR:-default}', () => {
  assert.equal(expandEnvVars('hi-${FOO:-fallback}', {}), 'hi-fallback');
  assert.equal(expandEnvVars('hi-${FOO:-fallback}', { FOO: 'x' } as NodeJS.ProcessEnv), 'hi-x');
  assert.equal(expandEnvVars('${workspaceFolder}/x'), '${workspaceFolder}/x');
});

test('normalizeServerDef: expands env in args/headers', () => {
  const def = normalizeServerDef({ command: 'npx', args: ['${TOKEN:-none}'], env: {} }, {
    TOKEN: 'abc',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(def, {
    transport: 'stdio',
    command: 'npx',
    args: ['abc'],
    env: {},
    extra: {},
  });
});

test('loadMcpConfig: prefers .mcp.json, locks cwd to projectPath', async () => {
  const dir = makeProject({
    '.mcp.json': JSON.stringify({
      mcpServers: { s: { command: 'cmd', cwd: '/etc' } },
    }),
    '.vscode/mcp.json': JSON.stringify({ servers: { other: { command: 'x' } } }),
  });
  const loaded = await loadMcpConfig(dir);
  assert.ok(loaded.source?.endsWith('.mcp.json'));
  assert.deepEqual(Object.keys(loaded.servers), ['s']);
  const def = loaded.servers.s;
  assert.equal(def?.transport, 'stdio');
  if (def?.transport === 'stdio') assert.equal(def.cwd, dir);
});

test('loadMcpConfig: falls back to .vscode/mcp.json, empty when none', async () => {
  const dir = makeProject({
    '.vscode/mcp.json': JSON.stringify({ servers: { v: { command: 'node' } } }),
  });
  const loaded = await loadMcpConfig(dir);
  assert.ok(loaded.source?.endsWith('mcp.json'));
  assert.deepEqual(Object.keys(loaded.servers), ['v']);

  const empty = await loadMcpConfig(makeProject({}));
  assert.equal(empty.source, null);
  assert.deepEqual(empty.servers, {});
});

test('loadMcpConfig: invalid JSON throws with file path', async () => {
  const dir = makeProject({ '.mcp.json': '{nope' });
  await assert.rejects(() => loadMcpConfig(dir), /\.mcp\.json/);
});
