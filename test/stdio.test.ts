import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Container } from '../apps/bootstrap.js';
import { dispatch } from '../apps/stdio/dispatch.js';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../apps/stdio/protocol.js';
import type { Logger } from '../apps/shared/types.js';
import { NodeFileSystem } from '../src/fm/index.js';
import { StreamRegistry } from '../apps/stdio/streams.js';

const logger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

function collect() {
  const lines: Array<JsonRpcResponse | JsonRpcNotification> = [];
  return {
    lines,
    out: (msg: JsonRpcResponse | JsonRpcNotification) => lines.push(msg),
  };
}

function req(method: string, params?: unknown, id: string | number = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

const workspaceFixture = (name: string) => ({
  id: 'ws-1',
  name,
  description: null,
  projectPath: '/tmp/ws',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

// ---------------------------------------------------------------- plain ----

test('dispatch: plain action returns a result envelope', async () => {
  const { lines, out } = collect();
  const ctx = {
    workspacesService: {
      create: async (input: { name: string; projectPath: string }) => workspaceFixture(input.name),
    },
  } as unknown as Container;

  await dispatch(
    { ctx, logger, out },
    req('create.workspace', { name: 'My WS', projectPath: '/tmp/ws' }),
  );

  assert.equal(lines.length, 1);
  const resp = lines[0] as JsonRpcResponse;
  assert.equal(resp.id, 1);
  assert.equal(resp.error, undefined);
  assert.equal((resp.result as { name: string }).name, 'My WS');
});

test('dispatch: no-param plain action works with empty params', async () => {
  const { lines, out } = collect();
  const ctx = {
    workspacesService: { findAll: async () => [workspaceFixture('A')] },
  } as unknown as Container;

  await dispatch({ ctx, logger, out }, req('list.workspace', undefined));

  assert.equal((lines[0] as JsonRpcResponse).error, undefined);
  assert.equal(((lines[0] as JsonRpcResponse).result as { length: number }).length, 1);
});

test('dispatch: no-param action rejects unexpected params', async () => {
  const { lines, out } = collect();
  await dispatch({ ctx: {} as Container, logger, out }, req('list.workspace', { bogus: 1 }));

  const resp = lines[0] as JsonRpcResponse;
  assert.equal(resp.error?.code, -32602);
});

test('dispatch: invalid params returns -32602', async () => {
  const { lines, out } = collect();
  await dispatch(
    { ctx: {} as Container, logger, out },
    req('create.workspace', { name: 'missing projectPath' }),
  );

  const resp = lines[0] as JsonRpcResponse;
  assert.equal(resp.id, 1);
  assert.equal(resp.error?.code, -32602);
  assert.ok(Array.isArray(resp.error?.data));
});

test('dispatch: unknown method returns -32601', async () => {
  const { lines, out } = collect();
  await dispatch({ ctx: {} as Container, logger, out }, req('nope.verb'));

  const resp = lines[0] as JsonRpcResponse;
  assert.equal(resp.error?.code, -32601);
});

test('dispatch: AppError maps to server error with code and status', async () => {
  const { lines, out } = collect();
  const ctx = {
    workspacesService: {
      findOne: async () => {
        throw new Error('boom');
      },
    },
  } as unknown as Container;

  await dispatch({ ctx, logger, out }, req('get.workspace', { id: 'nope' }));

  const resp = lines[0] as JsonRpcResponse;
  assert.equal(resp.error?.code, -32000);
  assert.equal((resp.error?.data as { code: string }).code, 'NOT_FOUND');
  assert.equal((resp.error?.data as { status: number }).status, 404);
});

test('dispatch: list.pending-approvals and decide.approval removed - shell now uses HITL callback', async () => {
  const { lines, out } = collect();
  await dispatch({ ctx: {} as Container, logger, out }, req('list.pending-approvals', undefined));
  assert.equal((lines[0] as JsonRpcResponse).error?.code, -32601);
  await dispatch(
    { ctx: {} as Container, logger, out },
    req('decide.approval', { id: 'missing', decision: 'allow' }),
  );
  assert.equal((lines[1] as JsonRpcResponse).error?.code, -32601);
});

// ------------------------------------------------------------- streaming ----

test('dispatch: send.message removed - use start.message-run + watch.message-run', async () => {
  const { lines, out } = collect();
  await dispatch(
    { ctx: {} as Container, logger, out },
    req('send.message', {
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      message: { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    }),
  );
  assert.equal((lines[0] as JsonRpcResponse).error?.code, -32601);
});

test('dispatch: watch.file streams file.event notifications and stops on abort', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stdio-watch-'));
  const { lines, out } = collect();
  const ac = new AbortController();

  const ctx = {
    fileSystem: new NodeFileSystem(),
    workspacesService: { findOne: async () => ({ projectPath: dir }) },
  } as unknown as Container;

  const pending = dispatch(
    { ctx, logger, out, signal: ac.signal },
    req('watch.file', { workspaceId: 'ws-1' }),
  );

  await new Promise((r) => setTimeout(r, 300));
  await writeFile(join(dir, 'hello.txt'), 'hi');

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (lines.some((l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  ac.abort();
  await pending;

  const events = lines.filter(
    (l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event',
  ) as JsonRpcNotification[];
  assert.ok(events.length >= 1, 'expected at least one file.event notification');

  const last = lines[lines.length - 1] as JsonRpcResponse;
  assert.equal(last.id, 1);
  assert.equal(last.error, undefined);
  assert.equal(last.result, null);

  await rm(dir, { recursive: true, force: true });
});

test('dispatch: cancel notification stops the file watch stream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stdio-cancel-'));
  const { lines, out } = collect();
  const registry = new StreamRegistry();

  const ctx = {
    fileSystem: new NodeFileSystem(),
    workspacesService: { findOne: async () => ({ projectPath: dir }) },
  } as unknown as Container;

  const pending = dispatch(
    { ctx, logger, out, streams: registry },
    req('watch.file', { workspaceId: 'ws-1' }),
  );

  await new Promise((r) => setTimeout(r, 300));
  await writeFile(join(dir, 'hello.txt'), 'hi');

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (lines.some((l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(
    lines.some((l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event'),
    'expected at least one file.event before cancel',
  );

  await dispatch(
    { ctx, logger, out, streams: registry },
    { jsonrpc: '2.0', id: null, method: 'cancel', params: { requestId: '1' } },
  );
  await pending;

  const eventsAtCancel = lines.filter(
    (l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event',
  ).length;

  await writeFile(join(dir, 'bye.txt'), 'x');
  await new Promise((r) => setTimeout(r, 300));

  const eventsAfterCancel = lines.filter(
    (l) => 'method' in l && (l as JsonRpcNotification).method === 'file.event',
  ).length;
  assert.equal(eventsAfterCancel, eventsAtCancel, 'watch kept emitting after cancel');

  const last = lines[lines.length - 1] as JsonRpcResponse;
  assert.equal(last.id, 1);
  assert.equal(last.error, undefined);
  assert.equal(last.result, null);

  await rm(dir, { recursive: true, force: true });
});
