import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toUIMessageStreamResponse } from '../../src/agent/adapters/ui.js';

function textStream(text: string): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: 't1' });
      controller.enqueue({ type: 'text-delta', id: 't1', text });
      controller.enqueue({ type: 'text-end', id: 't1' });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
      controller.close();
    },
  });
}

async function readSse(response: Response): Promise<string> {
  assert.ok(response.body, 'response must have a body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) out += decoder.decode(value, { stream: true });
    if (done) break;
  }
  return out;
}

test('adapter: callback shape with ignored emit streams only model chunks', async () => {
  const sse = await readSse(
    toUIMessageStreamResponse(() => ({ stream: textStream('hi') }) as never),
  );
  assert.ok(sse.includes('hi'), 'model text must reach the client');
  assert.ok(!sse.includes('data-list_files'), 'unused emit must not alter the stream');
});

test('adapter: callback shape streams an emitted data-* part live', async () => {
  const sse = await readSse(
    toUIMessageStreamResponse((emit) => {
      emit({
        type: 'data-list_files',
        id: 'c1:frontend:list_files',
        data: { toolCallId: 'c1', requestedPath: '.', nodes: [], total: 0 },
      });
      return { stream: textStream('hi') } as never;
    }),
  );
  assert.ok(sse.includes('hi'), 'model text must still reach the client');
  assert.ok(sse.includes('data-list_files'), 'emitted part must be streamed');
});
