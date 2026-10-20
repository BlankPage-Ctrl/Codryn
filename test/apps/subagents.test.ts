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
import type { ISubAgentLive, SubLiveMeta } from '../../src/runs/index.js';

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

function mockAgent(text = 'child answer'): Pick<AgentClient, 'loop'> {
  return {
    loop: (async () => ({ text: Promise.resolve(text) })) as unknown as Pick<
      AgentClient,
      'loop'
    >['loop'],
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
  assert.ok(names.includes('request_human'));
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
  assert.ok(names2.includes('request_human'));
});

test('filterChildTools lets a sub-agent opt out of asking the human', () => {
  const denied = {
    ...BUILTIN_SUBAGENTS[0]!,
    mode: 'edit' as const,
    disallowedTools: ['request_human'],
  };
  const names = filterChildTools(BASE_TOOLS, denied).map((t) => t.name);
  assert.ok(!names.includes('request_human'));
  assert.ok(names.includes('edit_file'));
});

test('filterChildTools grants MCP and plugin tools via explicit allowlist', () => {
  const askDefault = filterChildTools(BASE_TOOLS, BUILTIN_SUBAGENTS[0]!).map((t) => t.name);
  assert.ok(!askDefault.includes('mcp__github__search_code'));
  const def = { ...BUILTIN_SUBAGENTS[0]!, tools: ['mcp__github__search_code', 'my_plugin_tool'] };
  const names = filterChildTools(BASE_TOOLS, def).map((t) => t.name);
  assert.deepEqual(names.sort(), ['mcp__github__search_code', 'my_plugin_tool']);
  const wild = { ...BUILTIN_SUBAGENTS[0]!, tools: ['mcp__*'] };
  const wildNames = filterChildTools(BASE_TOOLS, wild).map((t) => t.name);
  assert.deepEqual(wildNames.sort(), ['mcp__github__search_code']);
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
  const miss = (await tool!.execute(
    { agent_name: 'nope', title: 'Do it', task: 'do it' },
    {},
  )) as string;
  assert.ok(miss.includes('`UNKNOWN_AGENT`'));
  assert.ok(miss.includes('`explorer`'));
  assert.ok(miss.includes('**Suggestion**'));
});

test('createSubAgentTool exposes describe_subagent with and without a name', async () => {
  const tools = createSubAgentTool({
    agents: BUILTIN_SUBAGENTS,
    parentModel: PARENT_MODEL,
    agent: mockAgent(),
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
  });
  const delegate = tools.find((t) => t.name === 'delegate_task')!;
  const describeTool = tools.find((t) => t.name === 'describe_subagent')!;
  assert.ok(delegate && describeTool);
  assert.ok(!delegate.description.includes('Available sub-agents'));

  const one = (await describeTool.execute({ agent_name: 'explorer' }, {})) as string;
  assert.ok(one.startsWith('explorer: '));
  assert.ok(one.includes(BUILTIN_SUBAGENTS[0]!.description));

  const all = (await describeTool.execute({}, {})) as string;
  assert.ok(all.includes('explorer: '));

  const miss = (await describeTool.execute({ agent_name: 'nope' }, {})) as string;
  assert.ok(miss.includes('`UNKNOWN_AGENT`'));
});

test('createSubAgentTool runs the child and falls back to parent model', async () => {
  let seenModel: ResolvedModel | null = null;
  const agent: Pick<AgentClient, 'loop'> = {
    loop: (async (opts: { model: ResolvedModel }) => {
      seenModel = opts.model;
      return { text: Promise.resolve('child answer') };
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
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
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(out.includes('child answer'));
  assert.ok(out.includes('stale-model'));
  assert.deepEqual(seenModel, PARENT_MODEL);
});

function rejectingAgent(err: unknown): Pick<AgentClient, 'loop'> {
  return {
    loop: (async () => {
      throw err;
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
  };
}

function delegateWith(
  agent: Pick<AgentClient, 'loop'>,
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
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(timedOut.includes('`CHILD_TIMEOUT`'));
  assert.ok(timedOut.includes('**Suggestion**'));

  const cancelledTool = delegateWith(rejectingAgent(new Error('aborted')), {
    signal: AbortSignal.abort(),
  });
  const cancelled = (await cancelledTool.execute(
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(cancelled.includes('`CHILD_ABORTED`'));
  assert.ok(cancelled.includes('Do not retry'));
});

test('delegate maps provider failures to CHILD_FAILED', async () => {
  const tool = delegateWith(rejectingAgent(new Error('cipher operation failed')));
  const out = (await tool.execute(
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(out.includes('`CHILD_FAILED`'));
  assert.ok(out.includes('**Suggestion**'));
});

test('delegate treats TimeoutError as child timeout', async () => {
  const timeoutErr = new Error('The operation timed out');
  timeoutErr.name = 'TimeoutError';
  const tool = delegateWith(rejectingAgent(timeoutErr));
  const out = (await tool.execute(
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    {},
  )) as string;
  assert.ok(out.includes('`CHILD_TIMEOUT`'));
});

test('delegate prefers the tool call abort signal over the stored signal', async () => {
  const tool = delegateWith(rejectingAgent(new Error('aborted')));
  const out = (await tool.execute(
    { agent_name: 'explorer', title: 'Find auth code', task: 'find auth code' },
    { abortSignal: AbortSignal.abort() },
  )) as string;
  assert.ok(out.includes('`CHILD_ABORTED`'));
});

function fakeSubLive(): {
  live: ISubAgentLive;
  subs: SubLiveMeta[];
  chunks: string[];
  done: string[];
  errors: string[];
} {
  const subs: SubLiveMeta[] = [];
  const chunks: string[] = [];
  const done: string[] = [];
  const errors: string[] = [];
  const live: ISubAgentLive = {
    ensureSub: (meta) => {
      subs.push(meta);
      return `sub:${meta.parentRunId}:${meta.toolCallId}`;
    },
    getSubMeta: (subKey) =>
      subs.find((s) => `sub:${s.parentRunId}:${s.toolCallId}` === subKey) ?? null,
    getSubStatus: () => 'running',
    isSubOpen: () => true,
    publishSubChunk: (_subKey, line) => {
      chunks.push(line);
      return true;
    },
    publishSubDone: (subKey) => {
      done.push(subKey);
    },
    publishSubError: (subKey) => {
      errors.push(subKey);
    },
    subscribeSub: () => () => {},
    framesSub: () => [],
    killSub: () => true,
    killSubsForRun: () => ({ killedCount: 0 }),
  };
  return { live, subs, chunks, done, errors };
}

test('delegate streams a child run through subLive and scopes shell feed ids', async () => {
  const def = BUILTIN_SUBAGENTS[0]!;
  const agent = {
    loop: (async (opts: { onChunk?: (event: { chunk: Record<string, unknown> }) => void }) => {
      opts.onChunk?.({
        chunk: { type: 'tool-call', toolCallId: 'call_shell', toolName: 'run_shell', input: {} },
      });
      opts.onChunk?.({
        chunk: { type: 'text-delta', id: 't1', text: 'working' },
      });
      return { text: Promise.resolve('child answer') };
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
  };
  const { live, subs, chunks, done } = fakeSubLive();
  let scopedArgs: { scope?: { subKey: string; parentRunId: string } } | null = null;

  const [tool] = createSubAgentTool({
    agents: [def],
    parentModel: PARENT_MODEL,
    agent,
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
    subLive: live,
    parentRun: {
      parentRunId: 'run_parent',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
      assistantMessageId: 'msg-1',
    },
    childToolset: (args) => {
      scopedArgs = args;
      return args.baseTools;
    },
    logger: { info() {}, error() {}, warn() {}, debug() {} },
  });

  const out = (await tool!.execute(
    { agent_name: def.name, title: 'Find auth code', task: 'find auth code' },
    { toolCallId: 'call_1' },
  )) as string;

  assert.ok(out.includes('child answer'));
  assert.equal(subs.length, 1);
  assert.equal(subs[0]!.toolCallId, 'call_1');
  assert.equal(subs[0]!.parentRunId, 'run_parent');
  assert.equal(subs[0]!.title, 'Find auth code');
  assert.equal(scopedArgs!.scope!.subKey, 'sub:run_parent:call_1');
  assert.deepEqual(done, ['sub:run_parent:call_1']);
  assert.ok(
    chunks.some(
      (line) => line.includes('"type":"run-open"') && line.includes('"title":"Find auth code"'),
    ),
  );
  assert.ok(chunks.some((line) => line.includes('"delta":"working"')));
  assert.ok(
    chunks.some((line) => line.includes('run_parent:call_shell')),
    'shell tool-call feed ids must be prefixed with the parent run id',
  );
});

test('delegate rebuilds child tools so rich results never reach the parent feed', async () => {
  const def = BUILTIN_SUBAGENTS[0]!;
  const parentRich: { implement: string }[] = [];
  const { live, chunks } = fakeSubLive();
  let childTools: AgentTool[] = [];
  let builderCalls = 0;

  const agent = {
    loop: (async () => {
      const read = childTools.find((tool) => tool.name === 'read_file');
      assert.ok(read);
      await read.execute({}, { toolCallId: 'child_read' });
      return { text: Promise.resolve('child answer') };
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
  };

  const [tool] = createSubAgentTool({
    agents: [def],
    parentModel: PARENT_MODEL,
    agent,
    baseTools: BASE_TOOLS,
    resolveModelHint: async () => null,
    onRichResult: (rich) => parentRich.push(rich),
    subLive: live,
    parentRun: {
      parentRunId: 'run_parent',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
      assistantMessageId: 'msg-1',
    },
    buildChildBaseTools: (onRichResult) => {
      builderCalls += 1;
      return [
        {
          name: 'read_file',
          description: 'child read',
          inputSchema: z.object({}),
          execute: async (_args, options) => {
            if (options?.toolCallId) {
              onRichResult({
                toolCallId: options.toolCallId,
                implement: 'read_file',
                body: { path: 'a.ts' },
              });
            }
            return 'ok';
          },
        },
      ];
    },
    childToolset: (args) => {
      childTools = args.baseTools;
      return args.baseTools;
    },
    logger: { info() {}, error() {}, warn() {}, debug() {} },
  });

  const out = (await tool!.execute(
    { agent_name: def.name, title: 'Read a file', task: 'read a file' },
    { toolCallId: 'call_1' },
  )) as string;

  assert.ok(out.includes('child answer'));
  assert.equal(builderCalls, 1);
  assert.ok(
    !parentRich.some((rich) => rich.implement === 'read_file'),
    'child rich results must not reach the parent sink',
  );
  assert.ok(
    chunks.some(
      (line) =>
        line.includes('"type":"notice"') &&
        line.includes('"callId":"child_read"') &&
        line.includes('"runId":"sub:run_parent:call_1"'),
    ),
    'child rich results must be published to the child feed',
  );
});
