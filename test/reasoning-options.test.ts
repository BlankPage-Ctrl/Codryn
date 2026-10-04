import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReasoningOptions } from '../apps/providers/reasoning/options.js';
import { installProviderPlugins } from '../apps/providers/registry.js';
import type { ModelCapability } from '../src/agent/types/index.js';

installProviderPlugins();

function capability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    reasoning: true,
    thinkingFormat: 'effort',
    thinkingCanDisable: true,
    thinkingRange: null,
    ...overrides,
  };
}

test('openai maps default level to native reasoning medium', () => {
  const out = buildReasoningOptions({
    providerType: 'openai',
    providerName: 'OpenAI',
    level: 'default',
  });

  assert.deepEqual(out, {
    reasoning: 'medium',
    providerOptions: { openai: { include: ['reasoning.encrypted_content'] } },
  });
});

test('openai passes level through as native reasoning field', () => {
  const out = buildReasoningOptions({
    providerType: 'openai',
    providerName: 'OpenAI',
    level: 'high',
  });

  assert.deepEqual(out, {
    reasoning: 'high',
    providerOptions: { openai: { include: ['reasoning.encrypted_content'] } },
  });
});

test('openai keeps reasoning none when level is none', () => {
  const out = buildReasoningOptions({
    providerType: 'openai',
    providerName: 'OpenAI',
    level: 'none',
  });

  assert.deepEqual(out, { reasoning: 'none' });
});

test('openai always requests encrypted reasoning content when reasoning is active', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh'] as const) {
    const out = buildReasoningOptions({
      providerType: 'openai',
      providerName: 'OpenAI',
      level,
    });

    assert.deepEqual(out.providerOptions?.openai?.include, ['reasoning.encrypted_content']);
  }
});

test('openrouter without capability maps default level to medium effort', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'default',
  });

  assert.deepEqual(out, {
    providerOptions: {
      openrouter: { reasoning: { effort: 'medium', enabled: true } },
    },
  });
});

test('openrouter without capability passes level through as effort', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'high',
  });

  assert.deepEqual(out.providerOptions?.openrouter, {
    reasoning: { effort: 'high', enabled: true },
  });
});

test('openrouter disables reasoning when level is none', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'none',
  });

  assert.deepEqual(out.providerOptions?.openrouter, {
    reasoning: { enabled: false },
  });
});

test('openrouter with capability clamps to supported efforts', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'medium',
    capability: capability({ thinkingRange: ['high', 'low'] }),
  });

  assert.deepEqual(out.providerOptions?.openrouter, {
    reasoning: { effort: 'high', enabled: true },
  });
});

test('openrouter forces reasoning back on for mandatory models even at none', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'none',
    capability: capability({
      thinkingCanDisable: false,
      thinkingRange: ['high', 'medium', 'low'],
    }),
  });

  assert.deepEqual(out.providerOptions?.openrouter, {
    reasoning: { effort: 'medium', enabled: true },
  });
});

test('openrouter returns empty options when capability has no reasoning', () => {
  const out = buildReasoningOptions({
    providerType: 'openrouter',
    providerName: 'My Router',
    level: 'high',
    capability: capability({ reasoning: false }),
  });

  assert.deepEqual(out, {});
});

test('unknown provider type falls back to portable default', () => {
  const out = buildReasoningOptions({
    providerType: 'community-x',
    providerName: 'Community X',
    level: 'high',
  });

  assert.deepEqual(out, { reasoning: 'high' });
});
