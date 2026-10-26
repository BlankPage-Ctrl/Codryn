import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelsDevCatalog } from '../../apps/providers/models-dev.js';
import { installProviderPlugins } from '../../apps/providers/registry.js';

installProviderPlugins();

const payload = {
  openai: {
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        limit: { context: 128000, input: 112000, output: 16384 },
        reasoning: false,
        tool_call: true,
        structured_output: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
  openrouter: {
    models: {
      'openrouter-only': { limit: { context: 1000, output: 100 } },
    },
  },
};

test('models.dev catalog: parses only provider types that opt in', async () => {
  let calls = 0;
  const catalog = createModelsDevCatalog({
    fetchImpl: (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => payload,
      } as Response;
    }) as typeof fetch,
  });

  const openai = await catalog.getModels('openai');
  assert.equal(openai.get('gpt-4o')?.displayName, 'GPT-4o');
  assert.equal(openai.get('gpt-4o')?.contextLength, 128000);
  assert.equal(openai.get('gpt-4o')?.maxInputTokens, 112000);
  assert.equal(openai.get('gpt-4o')?.maxOutputTokens, 16384);
  assert.equal(openai.get('gpt-4o')?.capabilities?.toolCalling, true);
  assert.equal(openai.get('gpt-4o')?.capabilities?.structuredOutput, true);
  assert.equal(openai.get('gpt-4o')?.capabilities?.vision, true);

  assert.equal((await catalog.getModels('openrouter')).size, 0);
  assert.equal((await catalog.getModels('openai-compatible')).size, 0);
  assert.equal(calls, 1);
});

test('models.dev catalog: failure returns an empty map and is cached briefly', async () => {
  let calls = 0;
  const catalog = createModelsDevCatalog({
    fetchImpl: (async () => {
      calls += 1;
      throw new Error('offline');
    }) as typeof fetch,
  });

  assert.equal((await catalog.getModels('openai')).size, 0);
  assert.equal((await catalog.getModels('openai')).size, 0);
  assert.equal(calls, 1);
});
