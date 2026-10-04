import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HitlRepository,
  HitlService,
  HitlEventBus,
  ValidationError,
  HitlRequestNotFoundError as NotFoundError,
  ConflictError,
  TimeoutError,
  CancelledError,
  type IColdHitlStorage,
  type HitlRequestRow,
  type NewHitlRequestRow,
  type HitlRequestPatchRow,
  type ApprovalRequest,
  type ChoiceRequest,
} from '../../src/human-in-the-loop/index.js';

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

test('request emits a request event and persists a pending row', async () => {
  const { svc, bus } = makeService();
  const seen: string[] = [];
  bus.on('request', (r) => seen.push(r.id));

  const req = await svc.request({
    type: 'approval',
    title: 'Transfer 5jt?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    payload: { contextPreview: { amount: 5_000_000 } },
  });

  assert.equal(req.status, 'pending');
  assert.equal(seen.length, 1);
  assert.equal(seen[0], req.id);

  const pending = await svc.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, req.id);

  await svc.cancel(req.id);
});

test('requestAndWait resolves with the stored request once a response is submitted', async () => {
  const { svc } = makeService();

  const waiting = svc.requestAndWait({
    type: 'approval',
    title: 'Publish?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    payload: {},
  });

  const req = await svc.listPending().then((r) => r[0]);
  const updated = await svc.submitResponse(req.id, { outcome: 'approved' });

  const result = await waiting;
  assert.equal(result.status, 'resolved');
  assert.equal((result as ApprovalRequest).response?.outcome, 'approved');
  assert.equal((updated as ApprovalRequest).response?.outcome, 'approved');
});

test('submitResponse throws when requireReasonOnReject and reason missing', async () => {
  const { svc } = makeService();
  const req = await svc.request({
    type: 'approval',
    title: 'Delete all?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    payload: { requireReasonOnReject: true },
  });

  await assert.rejects(
    () => svc.submitResponse(req.id, { outcome: 'rejected' }),
    (e: Error) => e instanceof ValidationError,
  );

  const ok = await svc.submitResponse(req.id, {
    outcome: 'rejected',
    reason: 'not safe',
  });
  assert.equal((ok as ApprovalRequest).response?.reason, 'not safe');
});

test('submitResponse enforces choice multi-select constraints', async () => {
  const { svc } = makeService();
  const req = await svc.request({
    type: 'choice',
    title: 'Pick',
    chatId: 'chat-1',
    executionId: 'exec-1',
    payload: {
      mode: 'multi',
      options: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ],
      minSelect: 2,
      maxSelect: 2,
    },
  });

  await assert.rejects(
    () => svc.submitResponse(req.id, { selected: ['a'] }),
    (e: Error) => e instanceof ValidationError,
  );

  const ok = await svc.submitResponse(req.id, { selected: ['a', 'b'] });
  assert.deepEqual((ok as ChoiceRequest).response?.selected, ['a', 'b']);
});

test('cancel withdraws a pending request and rejects any waiter', async () => {
  const { svc, bus } = makeService();
  const cancelled: string[] = [];
  bus.on('cancelled', (r) => cancelled.push(r.id));

  const waiting = svc.requestAndWait({
    type: 'ask',
    title: 'Name?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    timeoutMs: 60_000,
  });
  const req = await svc.listPending().then((r) => r[0]);
  await svc.cancel(req.id);

  await assert.rejects(
    () => waiting,
    (e: Error) => e instanceof CancelledError,
  );
  assert.equal(cancelled[0], req.id);

  const after = await svc.getById(req.id);
  assert.equal(after?.status, 'cancelled');
});

test('timeout auto-rejects an approval and expires an ask', async () => {
  const { svc: svcApproval } = makeService();
  const approvalWait = svcApproval.requestAndWait({
    type: 'approval',
    title: 'Auto?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    timeoutMs: 15,
  });
  const approvalResult = await approvalWait;
  assert.equal(approvalResult.status, 'resolved');
  assert.equal((approvalResult as ApprovalRequest).response?.outcome, 'rejected');

  const { svc: svcAsk } = makeService();
  const askWait = svcAsk.requestAndWait({
    type: 'ask',
    title: 'Never answered',
    chatId: 'chat-1',
    executionId: 'exec-1',
    timeoutMs: 15,
  });
  await assert.rejects(
    () => askWait,
    (e: Error) => e instanceof TimeoutError,
  );
  const expired = (await svcAsk.listPending()).length;
  assert.equal(expired, 0);
});

test('submitResponse on a resolved request throws Conflict', async () => {
  const { svc } = makeService();
  const req = await svc.request({
    type: 'approval',
    title: 'x',
    chatId: 'chat-1',
    executionId: 'exec-1',
  });
  await svc.submitResponse(req.id, { outcome: 'approved' });
  await assert.rejects(
    () => svc.submitResponse(req.id, { outcome: 'rejected' }),
    (e: Error) => e instanceof ConflictError,
  );
});

test('getById returns null for unknown id', async () => {
  const { svc } = makeService();
  const req = await svc.request({
    type: 'approval',
    title: 'x',
    chatId: 'chat-1',
    executionId: 'exec-1',
  });
  assert.equal(await svc.getById('nope'), null);
  await assert.rejects(
    () => svc.submitResponse('nope', { outcome: 'approved' }),
    (e: Error) => e instanceof NotFoundError,
  );

  await svc.cancel(req.id);
});
