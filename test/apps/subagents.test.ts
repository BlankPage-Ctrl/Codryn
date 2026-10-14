import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  BUILTIN_SUBAGENTS,
  createSubAgentTool,
  filterChildTools,
  matchModelHint,
  parseSubAgentFile,
} from '../../apps/agent/subagents/index.js';
import type { AgentClient, AgentTool, ResolvedModel } from '../../src/agent/index.js';

function stubTool(name: string): AgentTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: z.object({}),
    execute: async () => `ok:${name}`,
  };
}

const BASE_TOOLS = [
  'list_files',
  'read_file',
  'grep',
  'edit_file',
  'create_file',
  'run_shell',
  'request_human',
  'delegate_task',
  'skill',
  'write_plan',
  'mcp__github__search_code',
  'my_plugin_tool',
].map(stubTool);

const PARENT_MODEL: ResolvedModel = {
  providerConfig: { id: 'p1', type: 'openai', name: 'test', apiKey: 'k' },
  modelId: 'parent-model',
};

function mockAgent(text = 'child answer'): Pick<AgentClient, 'generate'> {
  return {
    generate: (async () => ({ text })) as unknown as Pick<AgentClient, 'generate'>['generate'],
  };
}

test('parseSubAgentFile reads frontmatter and falls back to filename', () => {
  const def = parseSubAgentFile(
    '---\ndescription: Does research\nmode: ask\nmaxSteps: 10\n---\nYou are a researcher.\n',
    '/proj/.codryn/agents/scout.md',
  );
  assert.ok(def);
  assert.equal(def.name, 'scout');
  assert.equal(def.mode, 'ask');
  assert.equal(def.maxSteps, 10);
  assert.equal(def.systemPrompt, 'You are a researcher.');
});

test('parseSubAgentFile accepts model alias and rejects missing description', () => {
  const withModel = parseSubAgentFile(
    '---\nname: helper\ndescription: Helps\nmodel: gpt-x\n---\nBody.\n',
    '/proj/helper.md',
  );
  assert.ok(withModel);
  assert.equal(withModel.modelHint, 'gpt-x');
  assert.equal(parseSubAgentFile('---\nmode: ask\n---\nBody.\n', '/proj/x.md'), null);
  assert.equal(parseSubAgentFile('no frontmatter', '/proj/x.md'), null);
});

test('builtin subagents ship explorer in ask mode', () => {
  const names = BUILTIN_SUBAGENTS.map((a) => a.name).sort();
  assert.deepEqual(names, ['explorer']);
  for (const def of BUILTIN_SUBAGENTS) assert.equal(def.mode, 'ask');
});

test('filterChildTools keeps read-only tools in ask mode and drops privileged ones', () => {
  const def = BUILTIN_SUBAGENTS[0]!;
  const names = filterChildTools(BASE_TOOLS, def).map((t) => t.name);
  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('grep'));
  assert.ok(!names.includes('edit_file'));
  assert.ok(!names.includes('run_shell'));
  assert.ok(!names.includes('request_human'));
  assert.ok(!names.includes('delegate_task'));
  assert.ok(!names.includes('write_plan'));
});

test('filterChildTools honors explicit tools and disallowedTools', () => {
  const def = { ...BUILTIN_SUBAGENTS[0]!, mode: 'edit' as const, tools: ['grep', 'edit_file'] };
  const names = filterChildTools(BASE_TOOLS, def).map((t) => t.name);
  assert.deepEqual(names.sort(), ['edit_file', 'grep']);
  const denied = {
    ...BUILTIN_SUBAGENTS[0]!,
    mode: 'edit' as const,
    disallowedTools: ['run_shell'],
  };
  const names2 = filterChildTools(BASE_TOOLS, denied).map((t) => t.name);
  assert.ok(!names2.includes('run_shell'));
  assert.ok(names2.includes('edit_file'));
  assert.ok(!names2.includes('request_human'));
});

test('filterChildTools grants MCP and plugin tools via explicit allowlist', () => {
  const askDefault = filterChildTools(BASE_TOOLS, BUILTIN_SUBAGENTS[0]!).map((t) => t.name);
  assert.ok(!askDefault.includes('mcp__github__search_code'));
  const def = { ...BUILTIN_SUBAGENTS[0]!, tools: ['mcp__github__search_code', 'my_plugin_tool'] };
  const names = filterChildTools(BASE_TOOLS, def).map((t) => t.name);
  assert.deepEqual(names.sort(), ['mcp__github__search_code', 'my_plugin_tool']);
  const wild = { ...BUILTIN_SUBAGENTS[0]!, tools: ['mcp__*'] };
  const wildNames = filterChildTools(BASE_TOOLS, wild).map((t) => t.name);
  assert.deepEqual(wildNames, ['mcp__github__search_code']);
  const denied = {
    ...BUILTIN_SUBAGENTS[0]!,
    mode: 'edit' as const,
    disallowedTools: ['mcp__*'],
  };
  const deniedNames = filterChildTools(BASE_TOOLS, denied).map((t) => t.name);
  assert.ok(!deniedNames.includes('mcp__github__search_code'));
  assert.ok(deniedNames.includes('my_plugin_tool'));
});

test('matchModelHint resolves ids and provider-qualified names', () => {
  const providers = [
    {
      id: 'p1',
      name: 'openai',
      models: [
        { id: 'm1', modelId: 'gpt-4o-mini' },
        { id: 'm2', modelId: 'gpt-4o' },
      ],
    },
  ];
  assert.deepEqual(matchModelHint(providers, 'gpt-4o'), {
    providerId: 'p1',
    modelId: 'gpt-4o',
  });
  assert.deepEqual(matchModelHint(providers, 'openai/gpt-4o-mini'), {
    providerId: 'p1',
    modelId: 'gpt-4o-mini',
  });
  assert.equal(matchModelHint(providers, 'missing-model'), null);
});

test('createSubAgentTool returns no tool without agents and lists names on miss', async () => {
  assert.deepEqual(
    createSubAgentTool({
      agents: [],
      parentModel: PARENT_MODEL,
      agent: mockAgent(),
      baseTools: BASE_TOOLS,
      resolveModelHint: async () => null,
    }),
    [],
  );
  const [tool] = createSubAgentTool({
    agents: BUILTIN_SUBAGENTS,
    parentModel: PARENT_MODEL,
    agent: mockAgent(),
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
  });
  const miss = (await tool!.execute({ agent_name: 'nope', task: 'do it' }, {})) as string;
  assert.ok(miss.includes('`UNKNOWN_AGENT`'));
  assert.ok(miss.includes('`explorer`'));
  assert.ok(miss.includes('**Suggestion**'));
});

test('createSubAgentTool runs the child and falls back to parent model', async () => {
  let seenModel: ResolvedModel | null = null;
  const agent: Pick<AgentClient, 'generate'> = {
    generate: (async (opts: { model: ResolvedModel }) => {
      seenModel = opts.model;
      return { text: 'child answer' };
    }) as unknown as Pick<AgentClient, 'generate'>['generate'],
  };
  const agents = [{ ...BUILTIN_SUBAGENTS[0]!, modelHint: 'stale-model' }];
  const [tool] = createSubAgentTool({
    agents,
    parentModel: PARENT_MODEL,
    agent,
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
  });
  const out = (await tool!.execute(
    { agent_name: 'explorer', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(out.includes('child answer'));
  assert.ok(out.includes('stale-model'));
  assert.deepEqual(seenModel, PARENT_MODEL);
});

function rejectingAgent(err: unknown): Pick<AgentClient, 'generate'> {
  return {
    generate: (async () => {
      throw err;
    }) as unknown as Pick<AgentClient, 'generate'>['generate'],
  };
}

function delegateWith(
  agent: Pick<AgentClient, 'generate'>,
  extra?: { signal?: AbortSignal },
): NonNullable<ReturnType<typeof createSubAgentTool>[number]> {
  const [tool] = createSubAgentTool({
    agents: BUILTIN_SUBAGENTS,
    parentModel: PARENT_MODEL,
    agent,
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
    ...(extra?.signal ? { signal: extra.signal } : {}),
  });
  return tool!;
}

test('delegate classifies child timeout and cancellation', async () => {
  const timeoutErr = new Error('The operation timed out');
  timeoutErr.name = 'AbortError';
  const timeoutTool = delegateWith(rejectingAgent(timeoutErr));
  const timedOut = (await timeoutTool.execute(
    { agent_name: 'explorer', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(timedOut.includes('`CHILD_TIMEOUT`'));
  assert.ok(timedOut.includes('**Suggestion**'));

  const cancelledTool = delegateWith(rejectingAgent(new Error('aborted')), {
    signal: AbortSignal.abort(),
  });
  const cancelled = (await cancelledTool.execute(
    { agent_name: 'explorer', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(cancelled.includes('`CHILD_ABORTED`'));
  assert.ok(cancelled.includes('Do not retry'));
});

test('delegate maps provider failures to CHILD_FAILED', async () => {
  const tool = delegateWith(rejectingAgent(new Error('cipher operation failed')));
  const out = (await tool.execute(
    { agent_name: 'explorer', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(out.includes('`CHILD_FAILED`'));
  assert.ok(out.includes('**Suggestion**'));
});
