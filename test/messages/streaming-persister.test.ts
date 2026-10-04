import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UIMessage } from 'ai';
import { StreamingPersister } from '../../src/messages/index.js';
import type { IMessagesRepository } from '../../src/messages/types/messages-repository.js';
import type { NewMessagePartRow } from '../../src/messages/types/message.js';

function fakeRepo() {
  const calls: {
    reconcileParts: Array<{ mid: string; rows: NewMessagePartRow[] }>;
    deleteMessage: Array<{ chatId: string; messageId: string }>;
  } = {
    reconcileParts: [],
    deleteMessage: [],
  };
  const repo = {
    append: async () => {},
    ensureMessage: async () => {},
    persistParts: async () => {},
    updateParts: async () => {},
    reconcileParts: async (mid: string, rows: NewMessagePartRow[]) => {
      calls.reconcileParts.push({ mid, rows });
    },
    deleteMessage: async (chatId: string, messageId: string) => {
      calls.deleteMessage.push({ chatId, messageId });
    },
  } as unknown as IMessagesRepository;
  return { repo, calls };
}

test('finalize: synthesizes a tool result for an orphan tool call', async () => {
  const { repo, calls } = fakeRepo();
  const persister = new StreamingPersister(repo, {
    chatId: 'c1',
    assistantMessageId: 'a1',
    userMessage: { id: 'u1', role: 'user', parts: [] },
  });

  await persister.prepare();

  const messages = [
    {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'tool-run_shell', toolCallId: 'tc1', state: 'input-available', input: {} }],
    },
  ] as unknown as UIMessage[];

  await persister.finalize(messages);

  assert.equal(calls.reconcileParts.length, 1);
  const rows = calls.reconcileParts[0].rows;
  const synth = rows.find((r) => r.toolCallId === 'tc1' && r.state === 'output-error');
  assert.ok(synth, 'expected a synthesized error tool result to be persisted');
  assert.equal(synth.errorText, 'Tool result missing (recovered)');
});

test('discard: deletes the partial assistant message and no-ops before prepare', async () => {
  const { repo, calls } = fakeRepo();
  const persister = new StreamingPersister(repo, {
    chatId: 'c1',
    assistantMessageId: 'a1',
    userMessage: { id: 'u1', role: 'user', parts: [] },
  });

  await persister.discard();
  assert.equal(calls.deleteMessage.length, 0);

  await persister.prepare();
  await persister.discard();
  assert.deepEqual(calls.deleteMessage, [{ chatId: 'c1', messageId: 'a1' }]);

  await persister.discard();
  assert.equal(calls.deleteMessage.length, 1);
});

test('attachData: rich payload lands on the tool row dataJson', async () => {
  const { repo } = fakeRepo();
  const persisted: NewMessagePartRow[] = [];
  const updated: NewMessagePartRow[] = [];
  repo.persistParts = async (rows: NewMessagePartRow[]) => {
    persisted.push(...rows);
  };
  repo.updateParts = async (rows: NewMessagePartRow[]) => {
    updated.push(...rows);
  };
  const errors: unknown[] = [];
  const persister = new StreamingPersister(
    repo,
    {
      chatId: 'c1',
      assistantMessageId: 'a1',
      userMessage: { id: 'u1', role: 'user', parts: [] },
    },
    (err: unknown) => errors.push(err),
  );

  await persister.prepare();
  await persister.onChunk({ type: 'tool-input-start', id: 'tc1', toolName: 'read_file' } as never);
  await persister.onChunk({
    type: 'tool-call',
    toolCallId: 'tc1',
    toolName: 'read_file',
    input: { path: 'x' },
  } as never);

  persister.attachData('tc1', { toolCallId: 'tc1', path: 'x', content: 'SECRET_RICH' });
  await persister.flush();

  const toolRow = updated.find((r) => r.toolCallId === 'tc1');
  assert.ok(toolRow, 'expected the tool row to be updated with dataJson');
  assert.ok(
    typeof toolRow.dataJson === 'string' && toolRow.dataJson.includes('SECRET_RICH'),
    'expected rich payload in dataJson',
  );
  assert.equal(errors.length, 0);
});

test('attachData: payload arriving before the draft is adopted on creation', async () => {
  const { repo } = fakeRepo();
  const persisted: NewMessagePartRow[] = [];
  repo.persistParts = async (rows: NewMessagePartRow[]) => {
    persisted.push(...rows);
  };
  const persister = new StreamingPersister(repo, {
    chatId: 'c1',
    assistantMessageId: 'a1',
    userMessage: { id: 'u1', role: 'user', parts: [] },
  });

  await persister.prepare();
  persister.attachData('tc9', { toolCallId: 'tc9', early: true });
  await persister.onChunk({
    type: 'tool-call',
    toolCallId: 'tc9',
    toolName: 'read_file',
    input: {},
  } as never);

  const toolRow = persisted.find((r) => r.toolCallId === 'tc9');
  assert.ok(toolRow, 'expected the tool row to be persisted');
  assert.ok(
    typeof toolRow.dataJson === 'string' && toolRow.dataJson.includes('"early":true'),
    'expected stashed payload adopted into dataJson',
  );
});

test('tool-error keeps inputJson from the earlier tool-call', async () => {
  const { repo } = fakeRepo();
  const persisted: NewMessagePartRow[] = [];
  const updated: NewMessagePartRow[] = [];
  repo.persistParts = async (rows: NewMessagePartRow[]) => {
    persisted.push(...rows);
  };
  repo.updateParts = async (rows: NewMessagePartRow[]) => {
    updated.push(...rows);
  };
  const persister = new StreamingPersister(repo, {
    chatId: 'c1',
    assistantMessageId: 'a1',
    userMessage: { id: 'u1', role: 'user', parts: [] },
  });

  await persister.prepare();
  await persister.onChunk({
    type: 'tool-call',
    toolCallId: 'tc1',
    toolName: 'read_file',
    input: { path: 'x' },
  } as never);
  // SDK may send input as undefined on error (provider-executed tools,
  // unmatched results). The earlier input must survive.
  await persister.onChunk({
    type: 'tool-error',
    toolCallId: 'tc1',
    toolName: 'read_file',
    input: undefined,
    error: 'boom',
  } as never);
  await persister.flush();

  const snapshots = [...persisted, ...updated].filter((r) => r.toolCallId === 'tc1');
  const toolRow = snapshots[snapshots.length - 1];
  assert.ok(toolRow, 'expected the tool row to be persisted');
  assert.equal(toolRow.state, 'output-error');
  assert.equal(toolRow.errorText, 'boom');
  assert.deepEqual(JSON.parse(toolRow.inputJson as string), { path: 'x' });
});

test('tool-error on a fresh row stores the chunk input', async () => {
  const { repo } = fakeRepo();
  const persisted: NewMessagePartRow[] = [];
  repo.persistParts = async (rows: NewMessagePartRow[]) => {
    persisted.push(...rows);
  };
  const persister = new StreamingPersister(repo, {
    chatId: 'c1',
    assistantMessageId: 'a1',
    userMessage: { id: 'u1', role: 'user', parts: [] },
  });

  await persister.prepare();
  await persister.onChunk({
    type: 'tool-error',
    toolCallId: 'tc2',
    toolName: 'grep',
    input: { pattern: 'foo' },
    error: 'bad pattern',
  } as never);
  await persister.flush();

  const toolRow = persisted.find((r) => r.toolCallId === 'tc2');
  assert.ok(toolRow, 'expected the tool row to be persisted');
  assert.equal(toolRow.state, 'output-error');
  assert.deepEqual(JSON.parse(toolRow.inputJson as string), { pattern: 'foo' });
});

test('attachData: unserializable payload never throws', async () => {
  const { repo } = fakeRepo();
  const errors: unknown[] = [];
  const persister = new StreamingPersister(
    repo,
    {
      chatId: 'c1',
      assistantMessageId: 'a1',
      userMessage: { id: 'u1', role: 'user', parts: [] },
    },
    (err: unknown) => errors.push(err),
  );

  await persister.prepare();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  persister.attachData('tc1', circular);
  assert.equal(errors.length, 1);
});
