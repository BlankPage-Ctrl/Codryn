import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createAgent } from '../../src/agent/client.js';
import {
  installProviderPlugins,
  buildReasoningOptions,
  resolveClientFactory,
  getModelCapability,
} from '../../apps/providers/index.js';
import { normalizeStepFinish } from '../../src/messages/engines/run-step-normalize.js';

installProviderPlugins();

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function startStub(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (req.url === '/chat/completions' && req.method === 'POST') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(
        sseChunk({
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'stub',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'halo' }, finish_reason: null },
          ],
        }),
      );
      res.write(
        sseChunk({
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'stub',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        }),
      );
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

test('agent loop() forwards onStepFinish/onFinish to streamText (regression: callbacks were dropped)', async () => {
  const { server, baseURL } = await startStub();
  try {
    const stepEvents: unknown[] = [];
    const finishEvents: unknown[] = [];
    const result = await createAgent({
      reasoning: buildReasoningOptions,
      clients: resolveClientFactory,
      capability: getModelCapability,
    }).loop({
      model: {
        providerConfig: { id: 'stub', name: 'stub', type: 'openai-compatible', baseURL },
        modelId: 'stub',
      },
      messages: [{ role: 'user', content: 'hai' }],
      thinkingLevel: 'none',
      abortSignal: AbortSignal.timeout(30_000),
      onStepFinish: async (event) => {
        stepEvents.push(event);
      },
      onFinish: async (event) => {
        finishEvents.push(event);
      },
    });

    await result.consumeStream();

    assert.equal(stepEvents.length, 1);
    const normalized = normalizeStepFinish(
      stepEvents[0] as { finishReason: unknown; usage: unknown },
    );
    assert.equal(normalized.finishReason, 'stop');
    assert.equal(normalized.inputTokens, 5);
    assert.equal(normalized.outputTokens, 7);
    assert.equal(normalized.totalTokens, 12);
    assert.equal(finishEvents.length, 1);
  } finally {
    server.close();
  }
});
