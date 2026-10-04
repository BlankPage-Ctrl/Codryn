import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages } from 'ai';
import type { UIMessage } from 'ai';
import { repairUnresolvedToolCalls } from '../../src/messages/engines/repair.js';

type PartRecord = Record<string, unknown>;

function partRecords(parts: unknown): PartRecord[] {
  return parts as unknown as PartRecord[];
}

function toolCallPart(toolCallId: string, state: string): PartRecord {
  return { type: 'tool-run_shell', toolCallId, state, input: {} };
}
function toolResultPart(toolCallId: string, state: string): PartRecord {
  return { type: 'tool-run_shell', toolCallId, state, output: {} };
}

function asMessages(value: unknown): UIMessage[] {
  return value as unknown as UIMessage[];
}

test('repair: orphan tool call gets a synthesized error result', async () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [toolCallPart('tc1', 'input-available')],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  const resultParts = partRecords(repaired[0].parts).filter((p) => p.state === 'output-error');
  assert.equal(resultParts.length, 1);
  assert.equal(resultParts[0].toolCallId, 'tc1');
  assert.equal(resultParts[0].errorText, 'Tool result missing (recovered)');

  // convertToModelMessages must now succeed and include a resolved tool call.
  const modelMessages = await convertToModelMessages(repaired);
  assert.ok(Array.isArray(modelMessages));
  assert.ok(
    partRecords(repaired[0].parts).some(
      (p) => p.state === 'output-error' && p.toolCallId === 'tc1',
    ),
    'repaired message should carry the synthesized result',
  );
});

test('repair: tool call with a result is left untouched', () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [toolCallPart('tc1', 'input-available'), toolResultPart('tc1', 'output-available')],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  const outs = partRecords(repaired[0].parts).filter((p) => p.state === 'output-error');
  assert.equal(outs.length, 0);
});

test('repair: orphan tool call without input is dropped, not fabricated', () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'tool-run_shell', toolCallId: 'tc1', state: 'input-available' }],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  assert.equal(partRecords(repaired[0].parts).length, 0);
});

test('repair: split pair borrows the call input for the result part', () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [toolCallPart('tc1', 'input-available'), toolResultPart('tc1', 'output-available')],
    },
  ]);
  partRecords(messages[0].parts)[0].input = { command: 'ls' };

  const repaired = repairUnresolvedToolCalls(messages);
  const result = partRecords(repaired[0].parts).find(
    (p) => p.toolCallId === 'tc1' && p.state === 'output-available',
  );
  assert.deepEqual(result?.input, { command: 'ls' });
});

test('repair: tool call without input but with a result gets empty input', () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'tool-run_shell', toolCallId: 'tc1', state: 'input-available' },
        toolResultPart('tc1', 'output-available'),
      ],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  const call = partRecords(repaired[0].parts).find((p) => p.toolCallId === 'tc1');
  assert.deepEqual(call?.input, {});
  assert.equal(partRecords(repaired[0].parts).filter((p) => p.state === 'output-error').length, 0);
});

test('repair: dynamic-tool parts are repaired like static tool parts', () => {
  const withInput = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'run_shell',
          toolCallId: 'tc1',
          state: 'input-available',
          input: { command: 'ls' },
        },
      ],
    },
  ]);
  const repairedInput = repairUnresolvedToolCalls(withInput);
  assert.equal(
    partRecords(repairedInput[0].parts).filter((p) => p.state === 'output-error').length,
    1,
  );

  const withoutInput = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'run_shell',
          toolCallId: 'tc1',
          state: 'input-available',
        },
      ],
    },
  ]);
  const repairedBare = repairUnresolvedToolCalls(withoutInput);
  assert.equal(partRecords(repairedBare[0].parts).length, 0);
});

test('repair: every converted tool call carries arguments', async () => {
  const messages = asMessages([
    {
      id: 'm1',
      role: 'assistant',
      parts: [
        // Poisoned history: interrupted stream left input-less orphans.
        { type: 'tool-run_shell', toolCallId: 'tc1', state: 'input-streaming' },
        { type: 'tool-list_files', toolCallId: 'tc2', state: 'input-available' },
        toolCallPart('tc3', 'input-available'),
        toolResultPart('tc3', 'output-available'),
      ],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  const modelMessages = (await convertToModelMessages(repaired)) as unknown as Array<
    Record<string, unknown>
  >;
  const toolCalls = modelMessages.flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as PartRecord[]).filter((c) => c.type === 'tool-call')
      : [],
  );
  assert.ok(toolCalls.length > 0);
  for (const call of toolCalls) {
    assert.ok(
      call.input !== undefined,
      `tool call ${String(call.toolCallId)} is missing input (serializes without arguments)`,
    );
  }
  // The wire payload must not contain an argument-less tool call.
  const wire = JSON.stringify(modelMessages);
  assert.ok(!wire.includes('"tool-call","toolCallId":"tc1","toolName":"run_shell"}'));
});

test('repair: non-assistant messages are returned unchanged', () => {
  const messages = asMessages([
    {
      id: 'u1',
      role: 'user',
      parts: [toolCallPart('tc1', 'input-available')],
    },
  ]);

  const repaired = repairUnresolvedToolCalls(messages);
  assert.equal(repaired[0], messages[0]);
});
