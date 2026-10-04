import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HitlRequest, IHitlService } from '../../src/human-in-the-loop/index.js';
import { createFmPendingApproval, type FmPermissionInput } from '../../src/fm/index.js';
import { ok } from '../../src/fm/utils/result.js';
import { resolveFmPermissionViaHitl } from '../../apps/shared/fm-permission.js';
import {
  addFmAlwaysAllowed,
  clearFmAlwaysAllowed,
  fmAlwaysKey,
  isFmAlwaysAllowed,
} from '../../apps/shared/fm-always-allow.js';

type Outcome = 'approved' | 'rejected' | 'always_approved' | 'approved_with_modification';

function fakeApprovalRequest(outcome: Outcome): HitlRequest {
  return {
    id: 'hitl-1',
    title: 'File approval',
    description: null,
    correlationId: null,
    workspaceId: 'ws1',
    chatId: 'chat1',
    executionId: null,
    metadata: {},
    status: 'resolved',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    resolvedAt: new Date(),
    type: 'approval',
    payload: {},
    response: { outcome },
  } as unknown as HitlRequest;
}

function fakeHitl(outcome: Outcome, calls: { count: number }): IHitlService {
  return {
    requestAndWait: async () => {
      calls.count += 1;
      return fakeApprovalRequest(outcome);
    },
  } as unknown as IHitlService;
}

const permission: FmPermissionInput = {
  operation: 'read',
  requestedPath: '/tmp/codryn/note.md',
  absolutePath: '/tmp/codryn/note.md',
  workspaceRoot: '/tmp/ws',
  viaSymlink: false,
};

function makePending(executed: { count: number }) {
  return createFmPendingApproval<string>(permission, async () => {
    executed.count += 1;
    return ok('file-content');
  });
}

const ids = { workspaceId: 'ws1', chatId: 'chat1', toolCallId: 'call-1' };

test('fm-permission: approved runs the operation', async () => {
  const calls = { count: 0 };
  const executed = { count: 0 };
  clearFmAlwaysAllowed(fmAlwaysKey(ids.workspaceId, ids.chatId));
  const result = await resolveFmPermissionViaHitl(
    fakeHitl('approved', calls),
    makePending(executed),
    ids,
  );
  assert.equal(calls.count, 1);
  assert.equal(executed.count, 1);
  assert.equal(result.success, true);
});

test('fm-permission: rejected aborts without executing', async () => {
  const calls = { count: 0 };
  const executed = { count: 0 };
  clearFmAlwaysAllowed(fmAlwaysKey(ids.workspaceId, ids.chatId));
  const result = await resolveFmPermissionViaHitl(
    fakeHitl('rejected', calls),
    makePending(executed),
    ids,
  );
  assert.equal(calls.count, 1);
  assert.equal(executed.count, 0);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.code, 'PERMISSION_DENIED');
});

test('fm-permission: approved_with_modification is rejected (no with-modification for FM)', async () => {
  const calls = { count: 0 };
  const executed = { count: 0 };
  const key = fmAlwaysKey(ids.workspaceId, ids.chatId);
  clearFmAlwaysAllowed(key);
  const result = await resolveFmPermissionViaHitl(
    fakeHitl('approved_with_modification', calls),
    makePending(executed),
    ids,
  );
  assert.equal(calls.count, 1);
  assert.equal(executed.count, 0);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.code, 'PERMISSION_DENIED');
  // Must not be recorded as always-allowed either.
  assert.equal(isFmAlwaysAllowed(key, permission.absolutePath), false);
});

test('fm-permission: always_approved records RAM prefix and skips HITL next time', async () => {
  const key = fmAlwaysKey(ids.workspaceId, ids.chatId);
  clearFmAlwaysAllowed(key);
  const calls = { count: 0 };
  const executed = { count: 0 };
  const first = await resolveFmPermissionViaHitl(
    fakeHitl('always_approved', calls),
    makePending(executed),
    ids,
  );
  assert.equal(first.success, true);
  assert.equal(isFmAlwaysAllowed(key, permission.absolutePath), true);

  const calls2 = { count: 0 };
  const executed2 = { count: 0 };
  const second = await resolveFmPermissionViaHitl(
    fakeHitl('approved', calls2),
    makePending(executed2),
    ids,
  );
  assert.equal(calls2.count, 0);
  assert.equal(executed2.count, 1);
  assert.equal(second.success, true);
  assert.equal(addFmAlwaysAllowed(key, permission.absolutePath), false);
  clearFmAlwaysAllowed(key);
});

test('fm-permission: HITL failure aborts without executing', async () => {
  const executed = { count: 0 };
  clearFmAlwaysAllowed(fmAlwaysKey(ids.workspaceId, ids.chatId));
  const failing = {
    requestAndWait: async (): Promise<HitlRequest> => {
      throw new Error('hitl down');
    },
  } as unknown as IHitlService;
  const result = await resolveFmPermissionViaHitl(failing, makePending(executed), ids);
  assert.equal(executed.count, 0);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.code, 'PERMISSION_DENIED');
});
