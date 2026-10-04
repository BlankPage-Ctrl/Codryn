import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { jsonSchemaToZod } from '../../apps/mcp/json-schema.js';
import { formatMcpToolError, formatMcpToolResult } from '../../apps/mcp/format.js';
import { createMcpTools, mcpToolName } from '../../apps/mcp/tools.js';
import type { McpWorkspaceSnapshot } from '../../apps/mcp/manager.js';

test('mcpToolName: namespaces and sanitizes', () => {
  assert.equal(mcpToolName('default-drv', 'search'), 'mcp__default-drv__search');
  assert.equal(mcpToolName('My Server!', 'Get Weather'), 'mcp__my_server__get_weather');
  assert.ok(mcpToolName('s', 't').length <= 64);
});

test('jsonSchemaToZod: object with required/optional + description', () => {
  const schema = jsonSchemaToZod({
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
      units: { type: 'string', enum: ['c', 'f'] },
      limit: { type: 'integer', minimum: 1 },
    },
    required: ['location'],
  });
  assert.ok(schema instanceof z.ZodObject);
  const parsed = schema.parse({ location: 'NY' });
  assert.equal(parsed.location, 'NY');
  assert.throws(() => schema.parse({}), /location/i);
  assert.throws(() => schema.parse({ location: 'NY', units: 'x' }), /units|enum|invalid/i);
});

test('jsonSchemaToZod: malformed schema degrades, never throws', () => {
  assert.doesNotThrow(() => jsonSchemaToZod(null));
  assert.doesNotThrow(() => jsonSchemaToZod({ type: 'weird-thing' }));
  assert.doesNotThrow(() => jsonSchemaToZod('nope'));
});

test('formatMcpToolResult: text joined, binary omitted, capped', () => {
  const out = formatMcpToolResult('srv', 'tool', {
    content: [
      { type: 'text', text: 'hello' },
      { type: 'image' },
      { type: 'audio' },
      { type: 'resource_link', uri: 'file:///x' },
    ],
  });
  assert.ok(out.includes('hello'));
  assert.ok(out.includes('omitted'));
  assert.ok(out.includes('(image content from srv/tool, omitted from context)'));
  assert.ok(out.includes('(audio content from srv/tool, omitted from context)'));
  const big = formatMcpToolResult('srv', 'tool', {
    content: [{ type: 'text', text: 'a'.repeat(20_000) }],
  });
  assert.ok(big.includes('truncated'));
});

test('formatMcpToolResult: text-only, non-text text field never rendered', () => {
  const out = formatMcpToolResult('srv', 'tool', {
    content: [{ type: 'image', text: 'should-not-show' }],
  });
  assert.ok(!out.includes('should-not-show'));
  assert.ok(out.includes('(image content from srv/tool, omitted from context)'));
});

test('formatMcpToolError: per-code suggestions', () => {
  assert.ok(formatMcpToolError('MCP_APPROVAL_DENIED', 'no', 's', 't').includes('denied'));
  assert.ok(formatMcpToolError('MCP_TIMEOUT', 'slow', 's', 't').includes('too long'));
});

function snapshotWithTools(tools: McpWorkspaceSnapshot['tools']): McpWorkspaceSnapshot {
  return {
    workspaceId: 'ws',
    projectPath: '/tmp/proj',
    source: '/tmp/proj/.mcp.json',
    servers: ['srv'],
    tools,
    resources: [],
    prompts: [],
    truncated: false,
  };
}

test('createMcpTools: read-only auto-runs, destructive asks HITL', async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const manager = {
    callTool: async (
      ws: string,
      pp: string,
      server: string,
      tool: string,
      args: Record<string, unknown>,
    ) => {
      calls.push({ name: `${server}/${tool}`, args });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  let hitlCalls = 0;
  const hitl = {
    requestAndWait: async () => {
      hitlCalls++;
      return { type: 'approval', response: { outcome: 'approved' } } as never;
    },
  };
  const snapshot = snapshotWithTools([
    {
      server: 'srv',
      name: 'read',
      description: 'read things',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      server: 'srv',
      name: 'wipe',
      description: 'wipe things',
      inputSchema: { type: 'object', properties: {} },
      annotations: { destructiveHint: true },
    },
  ]);
  const tools = createMcpTools(snapshot, manager, {
    workspaceId: 'ws',
    projectPath: '/tmp/proj',
    chatId: 'chat',
    hitl: hitl as never,
    timeoutMs: 1000,
    elicitationEnabled: false,
  });
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.name, 'mcp__srv__read');
  assert.ok(String(tools[1]?.description).includes('DESTRUCTIVE'));

  const readOut = await (tools[0]?.execute as (a: unknown, o?: unknown) => Promise<unknown>)(
    {},
    { toolCallId: 'c1' },
  );
  assert.ok(String(readOut).includes('ok'));
  assert.equal(hitlCalls, 0);

  const wipeOut = await (tools[1]?.execute as (a: unknown, o?: unknown) => Promise<unknown>)(
    {},
    { toolCallId: 'c2' },
  );
  assert.ok(String(wipeOut).includes('ok'));
  assert.equal(hitlCalls, 1);
  assert.equal(calls.length, 2);
});

test('createMcpTools: denied approval returns error text, never throws', async () => {
  const manager = {
    callTool: async () => {
      throw new Error('must not be called');
    },
  };
  const hitl = {
    requestAndWait: async () => ({ type: 'approval', response: { outcome: 'rejected' } }) as never,
  };
  const tools = createMcpTools(
    snapshotWithTools([
      { server: 'srv', name: 'write', inputSchema: { type: 'object', properties: {} } },
    ]),
    manager,
    {
      workspaceId: 'ws',
      projectPath: '/p',
      chatId: 'c',
      hitl: hitl as never,
      timeoutMs: 1000,
      elicitationEnabled: false,
    },
  );
  const out = await (tools[0]?.execute as (a: unknown) => Promise<unknown>)({});
  assert.ok(String(out).includes('MCP_APPROVAL_DENIED'));
});

test('createMcpTools: isError tool result becomes model-friendly error text', async () => {
  const manager = {
    callTool: async () => ({ content: [{ type: 'text', text: 'bad args' }], isError: true }),
  };
  const hitl = { requestAndWait: async () => ({}) as never };
  const tools = createMcpTools(
    snapshotWithTools([
      {
        server: 'srv',
        name: 'read',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
    ]),
    manager,
    {
      workspaceId: 'ws',
      projectPath: '/p',
      chatId: 'c',
      hitl: hitl as never,
      timeoutMs: 1000,
      elicitationEnabled: false,
    },
  );
  const out = await (tools[0]?.execute as (a: unknown) => Promise<unknown>)({});
  assert.ok(String(out).includes('MCP_TOOL_ERROR'));
});
