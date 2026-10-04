import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageAssembler, UIMessageMapper } from '../../src/messages/engines/index.js';
import type { MessagePartRow } from '../../src/messages/types/message.js';
import type { SystemTextPart } from '../../apps/shared/mention.js';

test('UIMessageMapper: text part round-trips the isSystem flag', () => {
  const row = UIMessageMapper.partToEntity('m1', 0, {
    type: 'text',
    text: 'file content',
    isSystem: true,
  } as SystemTextPart);

  assert.equal(row.type, 'text');
  assert.equal(row.isSystem, true);

  const part = UIMessageMapper.entityToPart(row as unknown as MessagePartRow);
  assert.equal((part as { isSystem?: boolean }).isSystem, true);
  assert.equal((part as { text: string }).text, 'file content');
});

test('UIMessageMapper: regular text part stays isSystem undefined', () => {
  const row = UIMessageMapper.partToEntity('m1', 0, { type: 'text', text: 'hi' });

  assert.equal(row.isSystem, undefined);

  const part = UIMessageMapper.entityToPart(row as unknown as MessagePartRow);
  assert.equal((part as { isSystem?: boolean }).isSystem, undefined);
});

test('UIMessageMapper: tool row dataJson never surfaces to UIMessage or model input', async () => {
  const row = UIMessageMapper.partToEntity('m1', 0, {
    type: 'tool-read_file',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { path: 'x.ts' },
    output: 'file shown to model',
  } as never);

  // Simulate a streamed rich payload attached to the same row.
  const stored = {
    ...(row as unknown as Record<string, unknown>),
    dataJson: JSON.stringify({ content: 'SECRET_RICH'.repeat(50) }),
  };

  const part = UIMessageMapper.entityToPart(stored as unknown as MessagePartRow);
  assert.equal((part as { type: string }).type, 'tool-read_file');
  assert.ok(
    !JSON.stringify(part).includes('SECRET_RICH'),
    'dataJson must not surface into UIMessage',
  );

  const asm = new MessageAssembler();
  asm.addMessage({ id: 'm1', role: 'assistant', parts: [part] });
  const modelMessages = await asm.toModelMessages();
  const json = JSON.stringify(modelMessages);
  assert.ok(!json.includes('SECRET_RICH'), 'rich dataJson must not reach the model');
  assert.ok(json.includes('file shown to model'), 'regular tool output still reaches the model');
});

test('UIMessageMapper: reasoning part round-trips encrypted providerMetadata', () => {
  const row = UIMessageMapper.partToEntity('m1', 0, {
    type: 'reasoning',
    text: 'summary here',
    providerMetadata: {
      openai: { itemId: 'rs_123', reasoningEncryptedContent: 'enc_blob' },
    },
  } as never);

  assert.equal(row.type, 'reasoning');
  assert.deepEqual(JSON.parse(row.providerMetadataJson as string), {
    openai: { itemId: 'rs_123', reasoningEncryptedContent: 'enc_blob' },
  });

  const part = UIMessageMapper.entityToPart(row as unknown as MessagePartRow) as {
    type: string;
    providerMetadata?: unknown;
  };
  assert.equal(part.type, 'reasoning');
  assert.deepEqual(part.providerMetadata, {
    openai: { itemId: 'rs_123', reasoningEncryptedContent: 'enc_blob' },
  });
});

test('convertToModelMessages: frontend data-* parts are ignored (zero tokens)', async () => {
  const asm = new MessageAssembler();
  asm.addMessage({
    id: 'm1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'text', text: 'done' },
      {
        type: 'data-read_file',
        id: 'call-9:frontend:read_file',
        data: { toolCallId: 'call-9', path: 'x.ts', content: 'SECRET_RAW'.repeat(100) },
      } as never,
    ],
  });
  const modelMessages = await asm.toModelMessages();
  const json = JSON.stringify(modelMessages);
  assert.ok(!json.includes('SECRET_RAW'), 'raw frontend payload must not reach the model');
  assert.ok(json.includes('done'), 'regular text still reaches the model');
});
