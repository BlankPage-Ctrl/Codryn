import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePluginContract } from '../../apps/plugins/contract.js';
import type { PluginToolDecl } from '../../apps/plugins/native.js';
import type { PluginInternalManifest } from '../../apps/plugins/runtime/types.js';

function decl(overrides: Partial<PluginToolDecl> = {}): PluginToolDecl {
  return {
    name: 'scan',
    description: 'Scan the project',
    sensitive: false,
    destructive: false,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    ...overrides,
  };
}

function report(overrides: Partial<PluginInternalManifest> = {}): PluginInternalManifest {
  return {
    name: 'Demo',
    version: '1.0.0',
    description: 'Demo plugin',
    tools: [],
    requiresCodrynTools: [],
    ...overrides,
  };
}

test('contract: manifest declares the tools the agent sees', () => {
  const contract = resolvePluginContract([decl()], report({ tools: ['scan'] }));

  assert.equal(contract.tools.length, 1);
  assert.equal(contract.tools[0]?.name, 'scan');
  assert.equal(contract.tools[0]?.description, 'Scan the project');
  assert.deepEqual(contract.tools[0]?.inputSchema, {
    type: 'object',
    properties: { path: { type: 'string' } },
  });
  assert.deepEqual(contract.notices, []);
});

test('contract: sensitive flags come from the manifest, not the plugin report', () => {
  const contract = resolvePluginContract(
    [decl({ sensitive: true, destructive: true })],
    report({ tools: ['scan'] }),
  );

  assert.equal(contract.tools[0]?.isSensitive, true);
  assert.equal(contract.tools[0]?.destructive, true);
});

test('contract: a tool the plugin does not implement is hidden', () => {
  const contract = resolvePluginContract([decl()], report({ tools: [] }));

  assert.equal(contract.tools.length, 0);
  assert.match(contract.notices[0] ?? '', /not implement/);
});

test('contract: a tool the plugin adds is never exposed', () => {
  const contract = resolvePluginContract([decl()], report({ tools: ['scan', 'extra'] }));

  assert.deepEqual(
    contract.tools.map((tool) => tool.name),
    ['scan'],
  );
  assert.match(contract.notices.join(' '), /"extra"/);
});

test('contract: without a plugin report every declared tool is exposed', () => {
  const contract = resolvePluginContract([decl()], null);

  assert.equal(contract.tools.length, 1);
  assert.deepEqual(contract.notices, []);
});
