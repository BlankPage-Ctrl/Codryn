import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HitlRepository,
  HitlService,
  HitlEventBus,
  type IColdHitlStorage,
  type HitlRequest,
  type HitlRequestRow,
  type NewHitlRequestRow,
  type HitlRequestPatchRow,
} from '../../src/human-in-the-loop/index.js';
import { createHitlTool } from '../../apps/agent/tools/hitl.js';
import { BUILTIN_SUBAGENTS, createSubAgentTool } from '../../apps/agent/subagents/index.js';
import {
  cancelSubAgentHitl,
  scopeAwareHitlService,
  subAgentScopeFromMetadata,
  withSubAgentHitlScope,
  type HitlSubAgentScope,
} from '../../apps/agent/subagents/hitl-scope.js';
import type { AgentClient, ResolvedModel } from '../../src/agent/index.js';

class MemoryHitlStorage implements IColdHitlStorage {
  private rows = new Map<string, HitlRequestRow>();

  async findById(id: string): Promise<HitlRequestRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findManyByStatus(status: string): Promise<HitlRequestRow[]> {
    return [...this.rows.values()].filter((r) => r.status === status);
  }

  async insert(row: NewHitlRequestRow): Promise<void> {
    this.rows.set(row.id as string, row as HitlRequestRow);
  }

  async update(id: string, patch: HitlRequestPatchRow): Promise<HitlRequestRow> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`missing ${id}`);
    const next = { ...current, ...patch } as HitlRequestRow;
    this.rows.set(id, next);
    return next;
  }
}

function makeService(): { svc: HitlService; bus: HitlEventBus } {
  const repo = new HitlRepository(new MemoryHitlStorage());
  const bus = new HitlEventBus();
  return { svc: new HitlService(repo, bus), bus };
}

const SCOPE: HitlSubAgentScope = {
  parentRunId: 'run_1',
  toolCallId: 'call_delegate',
  agentName: 'explorer',
  title: 'Find the auth code',
};

test("a sub-agent's question carries the child provenance", async () => {
  const { svc, bus } = makeService();
  const scoped = scopeAwareHitlService(svc);
  const tool = withSubAgentHitlScope(
    createHitlTool(scoped, { chatId: 'chat-1', workspaceId: 'ws-1' })[0]!,
    SCOPE,
  );

  let captured: HitlRequest | null = null;
  bus.on('request', (request) => {
    captured = request;
    void svc.submitResponse(request.id, { outcome: 'approved' });
  });

  await tool.execute({ kind: 'approval', title: 'Ship it?' }, { toolCallId: 'call-1' });

  assert.ok(captured);
  const metadata = (captured as HitlRequest).metadata;
  assert.equal(metadata.subAgentToolCallId, 'call_delegate');
  assert.equal(metadata.subAgentParentRunId, 'run_1');
  assert.equal(metadata.subAgentName, 'explorer');
  assert.equal(metadata.subAgentTitle, 'Find the auth code');
  assert.equal(metadata.source, 'agent');
});

test('a request raised by the parent run stays unscoped', async () => {
  const { svc, bus } = makeService();
  const scoped = scopeAwareHitlService(svc);
  const tool = createHitlTool(scoped, { chatId: 'chat-1', workspaceId: 'ws-1' })[0]!;

  let captured: HitlRequest | null = null;
  bus.on('request', (request) => {
    captured = request;
    void svc.submitResponse(request.id, { outcome: 'approved' });
  });

  await tool.execute({ kind: 'approval', title: 'Ship it?' }, { toolCallId: 'call-1' });

  assert.ok(captured);
  assert.equal((captured as HitlRequest).metadata.subAgentToolCallId, undefined);
  assert.equal(subAgentScopeFromMetadata((captured as HitlRequest).metadata), null);
});

test('the parent request_human carries the run id', async () => {
  const { svc, bus } = makeService();
  const scoped = scopeAwareHitlService(svc);
  const tool = createHitlTool(scoped, {
    chatId: 'chat-1',
    workspaceId: 'ws-1',
    runId: 'run_1',
  })[0]!;

  let captured: HitlRequest | null = null;
  bus.on('request', (request) => {
    captured = request;
    void svc.submitResponse(request.id, { outcome: 'approved' });
  });

  await tool.execute(
    { kind: 'approval', title: 'Ship it?', metadata: { runId: 'forged' } },
    { toolCallId: 'call-1' },
  );

  assert.ok(captured);
  assert.equal((captured as HitlRequest).metadata.runId, 'run_1');
});

test('the child scope overrides a scope the model tried to forge', async () => {
  const { svc, bus } = makeService();
  const scoped = scopeAwareHitlService(svc);
  const tool = withSubAgentHitlScope(
    createHitlTool(scoped, { chatId: 'chat-1', workspaceId: 'ws-1' })[0]!,
    SCOPE,
  );

  let captured: HitlRequest | null = null;
  bus.on('request', (request) => {
    captured = request;
    void svc.submitResponse(request.id, { outcome: 'approved' });
  });

  await tool.execute(
    { kind: 'approval', title: 'Ship it?', metadata: { subAgentToolCallId: 'forged' } },
    { toolCallId: 'call-1' },
  );

  assert.ok(captured);
  assert.equal((captured as HitlRequest).metadata.subAgentToolCallId, 'call_delegate');
});

test('cancelSubAgentHitl clears the questions of one child only', async () => {
  const { svc } = makeService();
  const scoped = scopeAwareHitlService(svc);

  await scoped.request({
    type: 'approval',
    title: 'Child A',
    chatId: 'chat-1',
    metadata: { subAgentToolCallId: 'call_a', subAgentParentRunId: 'run_1' },
  });
  await scoped.request({
    type: 'approval',
    title: 'Child B',
    chatId: 'chat-1',
    metadata: { subAgentToolCallId: 'call_b', subAgentParentRunId: 'run_1' },
  });
  await scoped.request({
    type: 'approval',
    title: 'Parent',
    chatId: 'chat-1',
  });

  const cleanup = await cancelSubAgentHitl(svc, (owner) => owner.toolCallId === 'call_a');
  assert.equal(cleanup.cancelled, 1);
  assert.equal(cleanup.failures, 0);

  const remaining = (await svc.listPending()).map((r) => r.title).sort();
  assert.deepEqual(remaining, ['Child B', 'Parent']);

  for (const request of await svc.listPending()) {
    await svc.cancel(request.id);
  }
});

const PARENT_MODEL: ResolvedModel = {
  providerConfig: { id: 'p1', type: 'openai', name: 'test', apiKey: 'k' },
  modelId: 'parent-model',
};

test('a question raised through the delegate carries the child scope', async () => {
  const { svc, bus } = makeService();
  const scoped = scopeAwareHitlService(svc);
  const [hitlTool] = createHitlTool(scoped, { chatId: 'chat-1', workspaceId: 'ws-1' });

  let childSystem = '';
  const agent = {
    loop: (async (opts: {
      system: string;
      tools: Record<
        string,
        { execute: (args: unknown, options: { toolCallId: string }) => Promise<unknown> }
      >;
    }) => {
      childSystem = opts.system;
      const ask = opts.tools.request_human;
      assert.ok(ask);
      await ask.execute({ kind: 'approval', title: 'Ship it?' }, { toolCallId: 'call_child' });
      return { text: Promise.resolve('child answer') };
    }) as unknown as Pick<AgentClient, 'loop'>['loop'],
  };

  const [delegate] = createSubAgentTool({
    agents: BUILTIN_SUBAGENTS,
    parentModel: PARENT_MODEL,
    agent,
    baseTools: [hitlTool!],
    resolveModelHint: async () => null,
    parentRun: {
      parentRunId: 'run_1',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
      assistantMessageId: 'msg-1',
    },
  });

  let captured: HitlRequest | null = null;
  bus.on('request', (request) => {
    captured = request;
    void svc.submitResponse(request.id, { outcome: 'approved' });
  });

  await delegate!.execute(
    { agent_name: 'explorer', title: 'Find the auth code', task: 'find the auth code' },
    { toolCallId: 'call_delegate' },
  );

  assert.ok(captured);
  assert.equal((captured as HitlRequest).metadata.subAgentToolCallId, 'call_delegate');
  assert.equal((captured as HitlRequest).metadata.subAgentParentRunId, 'run_1');
  assert.equal((captured as HitlRequest).metadata.subAgentName, 'explorer');
  assert.equal((captured as HitlRequest).metadata.subAgentTitle, 'Find the auth code');
  assert.ok(childSystem.includes('request_human'));
});
