import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UIMessage } from 'ai';
import { MessageAssembler } from '../../src/messages/engines/index.js';
import type { AssemblerPart } from '../../src/messages/types/index.js';

function text(text: string, extra: Record<string, unknown> = {}): AssemblerPart {
  return { type: 'text', text, ...extra } as AssemblerPart;
}

function msg(id: string, role: UIMessage['role'], parts: AssemblerPart[]): UIMessage {
  return { id, role, parts };
}

test('MessageAssembler: addMessage + resolve returns messages in insertion order', () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [text('hello')] });
  a.addMessage({ id: 'm2', role: 'assistant', parts: [text('hi')] });

  const resolved = a.resolve();
  assert.equal(resolved.length, 2);
  assert.deepEqual(
    resolved.map((m) => m.id),
    ['m1', 'm2'],
  );
  assert.equal(resolved[0].role, 'user');
  assert.deepEqual(resolved[0].parts, [{ type: 'text', text: 'hello' }]);
});

test('MessageAssembler: duplicate message id throws', () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [] });
  assert.throws(() => a.addMessage({ id: 'm1', role: 'user', parts: [] }), /already exists/);
});

test('MessageAssembler: upsertMessage keeps existing message untouched', () => {
  const a = new MessageAssembler();
  a.upsertMessage('m1', 'user', [text('a')]);
  a.upsertMessage('m1', 'assistant', [text('b')]);
  const m = a.getMessage('m1')!;
  assert.equal(m.role, 'user');
  assert.equal(m.parts.length, 1);
  assert.equal((m.parts[0] as { text: string }).text, 'a');
});

test('MessageAssembler: addPart appends at the end by default', () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [text('a')] });
  a.addPart('m1', text('b'));
  a.addPart('m1', text('c'));

  const m = a.getMessage('m1')!;
  assert.deepEqual(
    m.parts.map((p) => (p as { text: string }).text),
    ['a', 'b', 'c'],
  );
});

test('MessageAssembler: addPart with at inserts and shifts positions', () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [text('a'), text('b'), text('c')] });
  a.addPart('m1', text('X'), { at: 1 });

  const m = a.getMessage('m1')!;
  assert.deepEqual(
    m.parts.map((p) => (p as { text: string }).text),
    ['a', 'X', 'b', 'c'],
  );
});

test('MessageAssembler: updatePart patches an existing part', () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [text('a')] });

  const [first] = a.getParts('m1');
  a.updatePart('m1', first.id, { text: 'patched' });

  const m = a.getMessage('m1')!;
  assert.equal((m.parts[0] as { text: string }).text, 'patched');
  assert.throws(() => a.updatePart('m1', 'missing', { text: 'x' }), /not found/);
});

test('MessageAssembler: removePart drops the part and reindexes', () => {
  const a = new MessageAssembler();
  a.addMessage({
    id: 'm1',
    role: 'user',
    parts: [text('a'), text('b'), text('c')],
  });

  const ids = a.getParts('m1').map((p) => p.id);
  a.removePart('m1', ids[1]);

  const m = a.getMessage('m1')!;
  assert.deepEqual(
    m.parts.map((p) => (p as { text: string }).text),
    ['a', 'c'],
  );
  assert.throws(() => a.removePart('m1', ids[1]), /not found/);
});

test('MessageAssembler: merge imports messages and dedupes by id', () => {
  const a = new MessageAssembler();
  a.merge([msg('m1', 'user', [text('a')]), msg('m2', 'assistant', [text('b')])]);
  a.merge([msg('m2', 'assistant', [text('CHANGED')])]);

  const resolved = a.resolve();
  assert.deepEqual(
    resolved.map((m) => m.id),
    ['m1', 'm2'],
  );
  assert.equal((resolved[1].parts[0] as { text: string }).text, 'b');
});

test('MessageAssembler: textOf joins non-system text parts only', () => {
  const a = new MessageAssembler();
  a.addMessage({
    id: 'm1',
    role: 'user',
    parts: [text('hello '), text('world'), text('hidden', { isSystem: true })],
  });

  assert.equal(a.textOf('m1'), 'hello world');
  assert.equal(a.textOf('m1', { includeSystem: true }), 'hello worldhidden');
  assert.throws(() => a.textOf('nope'), /not found/);
});

test('MessageAssembler: toModelMessages returns model messages for the agent loop', async () => {
  const a = new MessageAssembler();
  a.addMessage({ id: 'm1', role: 'user', parts: [text('hello')] });
  a.addMessage({ id: 'm2', role: 'assistant', parts: [text('hi')] });

  const modelMessages = await a.toModelMessages();
  assert.equal(modelMessages.length, 2);
  assert.deepEqual(
    modelMessages.map((m) => m.role),
    ['user', 'assistant'],
  );
  const first = modelMessages[0] as { content: Array<{ type: string; text: string }> };
  assert.equal(first.content[0].type, 'text');
  assert.equal(first.content[0].text, 'hello');
});

test('MessageAssembler: message metadata round-trips through getMessage and resolve', () => {
  const a = new MessageAssembler();
  a.addMessage({
    id: 'm1',
    role: 'user',
    metadata: { title: 'x' },
    parts: [text('hello')],
  });
  a.merge([
    {
      id: 'm2',
      role: 'assistant',
      metadata: { title: 'y' },
      parts: [text('hi')],
    } as UIMessage,
  ]);

  assert.deepEqual(a.getMessage('m1')!.metadata, { title: 'x' });
  assert.deepEqual(a.resolve()[1].metadata, { title: 'y' });

  a.addMessage({ id: 'm3', role: 'user', parts: [text('no-meta')] });
  assert.equal(a.getMessage('m3')!.metadata, undefined);
});

test('MessageAssembler: reconcile produces insert/update/delete diff', () => {
  const a = new MessageAssembler();
  const existing = [
    { position: 0, id: 'p0' },
    { position: 1, id: 'p1' },
    { position: 2, id: 'p2' },
  ];

  const diff = a.reconcile(existing, [text('new0'), text('updated1')]);
  assert.equal(diff.inserts.length, 0);
  assert.deepEqual(
    diff.updates.map((u) => u.position),
    [0, 1],
  );
  assert.deepEqual(
    diff.deletes.map((d) => d.id),
    ['p2'],
  );

  const diff2 = a.reconcile(existing, [text('new0'), text('new1'), text('new2'), text('new3')]);
  assert.equal(diff2.inserts.length, 1);
  assert.equal(diff2.inserts[0].position, 3);
  assert.equal(diff2.updates.length, 3);
  assert.equal(diff2.deletes.length, 0);

  const diff3 = a.reconcile([], [text('a')]);
  assert.equal(diff3.inserts.length, 1);
  assert.equal(diff3.inserts[0].position, 0);
});
