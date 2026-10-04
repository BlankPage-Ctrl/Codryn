import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcpElicitation } from '../../apps/mcp/elicitation.js';
import { buildResourceSystemParts, formatResourceForModel } from '../../apps/mcp/resources.js';
import { getMcpPromptText, listMcpPromptCommands } from '../../apps/mcp/prompts.js';
import type { McpWorkspaceSnapshot } from '../../apps/mcp/manager.js';

function baseSnapshot(): McpWorkspaceSnapshot {
  return {
    workspaceId: 'ws',
    projectPath: '/tmp/proj',
    source: '/tmp/proj/.mcp.json',
    servers: ['srv'],
    tools: [],
    resources: [
      { server: 'srv', uri: 'file:///notes.md', name: 'notes', mimeType: 'text/markdown' },
    ],
    prompts: [{ server: 'srv', name: 'review', description: 'Review code' }],
    truncated: false,
  };
}

test('formatResourceForModel: header + truncation', () => {
  const out = formatResourceForModel('file:///a.md', 'hello');
  assert.ok(out.includes('file:///a.md'));
  assert.ok(out.includes('hello'));
  const big = formatResourceForModel('file:///a.md', 'x'.repeat(20_000));
  assert.ok(big.includes('truncated'));
});

test('buildResourceSystemParts: opt-in pick only (default injects nothing)', async () => {
  const manager = {
    readResource: async () => 'content',
  };
  const none = await buildResourceSystemParts(baseSnapshot(), manager);
  assert.deepEqual(none, []);
  const some = await buildResourceSystemParts(baseSnapshot(), manager, (uri) =>
    uri.endsWith('notes.md'),
  );
  assert.equal(some.length, 1);
  assert.equal(some[0]?.isSystem, true);
});

test('listMcpPromptCommands: namespaced, never tool-shaped', async () => {
  const cmds = listMcpPromptCommands(baseSnapshot());
  assert.deepEqual(cmds, [
    { command: 'mcp:srv/review', server: 'srv', name: 'review', description: 'Review code' },
  ]);
  const text = await getMcpPromptText(
    baseSnapshot(),
    { getPrompt: async () => 'prompt!' },
    'srv',
    'review',
  );
  assert.equal(text, 'prompt!');
});

test('handleMcpElicitation: disabled returns notice, no HITL call', async () => {
  let hitlCalls = 0;
  const out = await handleMcpElicitation(
    {
      resultType: 'input_required',
      inputRequests: {
        seat: { method: 'elicitation/create', params: { message: 'Pick a seat' } },
      },
    },
    {
      hitl: {
        requestAndWait: async () => {
          hitlCalls++;
          return {} as never;
        },
      },
      workspaceId: 'ws',
      chatId: 'c',
      timeoutMs: 1000,
      enabled: false,
      server: 'srv',
      tool: 'book',
      retry: async () => ({ content: [] }),
    },
  );
  assert.ok(String(out).includes('MCP_ELICITATION_DISABLED'));
  assert.equal(hitlCalls, 0);
});

test('handleMcpElicitation: sensitive fields refused without prompting', async () => {
  let hitlCalls = 0;
  const out = await handleMcpElicitation(
    {
      resultType: 'input_required',
      inputRequests: {
        login: {
          method: 'elicitation/create',
          params: {
            message: 'Login',
            requestedSchema: { type: 'object', properties: { password: { type: 'string' } } },
          },
        },
      },
    },
    {
      hitl: {
        requestAndWait: async () => {
          hitlCalls++;
          return {} as never;
        },
      },
      workspaceId: 'ws',
      chatId: 'c',
      timeoutMs: 1000,
      enabled: true,
      server: 'srv',
      tool: 'login-tool',
      retry: async () => ({ content: [] }),
    },
  );
  assert.ok(String(out).includes('MCP_ELICITATION_REFUSED'));
  assert.equal(hitlCalls, 0);
});

test('handleMcpElicitation: enabled collects via HITL and retries', async () => {
  const out = await handleMcpElicitation(
    {
      resultType: 'input_required',
      requestState: 'opaque-state',
      inputRequests: {
        seat: {
          method: 'elicitation/create',
          params: {
            message: 'Pick a seat',
            requestedSchema: { type: 'object', properties: { seat: { type: 'string' } } },
          },
        },
      },
    },
    {
      hitl: {
        requestAndWait: async () =>
          ({ type: 'ask', response: { value: '{"seat":"12A"}' } }) as never,
      },
      workspaceId: 'ws',
      chatId: 'c',
      timeoutMs: 1000,
      enabled: true,
      server: 'srv',
      tool: 'book',
      retry: async (inputResponses, requestState) => {
        assert.equal(requestState, 'opaque-state');
        assert.deepEqual(inputResponses, { seat: { action: 'accept', content: { seat: '12A' } } });
        return { content: [{ type: 'text', text: 'booked' }] };
      },
    },
  );
  assert.ok(String(out).includes('booked'));
});
