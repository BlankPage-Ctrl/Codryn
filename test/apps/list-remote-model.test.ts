import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Container } from '../../apps/bootstrap.js';
import { AppError, AuthError, ValidationError } from '../../apps/shared/errors.js';
import { buildModelListURL, modelListRequiresApiKey } from '../../apps/providers/model-list.js';
import type { ModelsDevModel } from '../../apps/providers/index.js';
import { ProviderNotFoundError } from '../../apps/providers/errors.js';
import { installProviderPlugins } from '../../apps/providers/registry.js';
import { openaiPlugin } from '../../apps/providers/builtin/openai.js';
import { openrouterPlugin } from '../../apps/providers/builtin/openrouter.js';
import { openaiCompatiblePlugin } from '../../apps/providers/builtin/openai-compatible.js';
import {
  RemoteModelsBodySchema,
  RemoteModelsRequestSchema,
} from '../../apps/validators/provider.js';
import { providerMethods } from '../../apps/stdio/registry/provider.js';
import { listRemoteModels } from '../../apps/actions/list.remote-model.js';

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

/** Container stub: real plugin metadata, fake stored providers, recorded fetch calls. */
function fixture(opts: {
  stored?: {
    id: string;
    type: string;
    apiKey: string | null;
    baseURL: string | null;
    updatedAt: Date;
  }[];
  response?: { status?: number; body?: unknown };
  modelsDev?: Map<string, ModelsDevModel>;
}) {
  const calls: FetchCall[] = [];
  let storeReads = 0;
  const stored = opts.stored ?? [];

  const endpoints = new Map(
    [openaiPlugin, openrouterPlugin, openaiCompatiblePlugin].map((p) => [p.id, p.modelList]),
  );

  const ctx = {
    providerService: {
      getModelListEndpoint: (type: string) => endpoints.get(type) ?? null,
      findProviderByType: async (type: string) => {
        storeReads += 1;
        const matches = stored.filter((p) => p.type === type);
        if (matches.length === 0) return null;
        return matches.reduce((newest, p) => {
          if (p.updatedAt.getTime() !== newest.updatedAt.getTime()) {
            return p.updatedAt > newest.updatedAt ? p : newest;
          }
          return p.id < newest.id ? p : newest;
        });
      },
      findProviderById: async (id: string) => {
        storeReads += 1;
        return stored.find((p) => p.id === id) ?? null;
      },
    },
    modelsDevCatalog: {
      getModels: async () => opts.modelsDev ?? new Map(),
    },
  } as unknown as Container;

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(input), headers: init?.headers ?? {} });
    const status = opts.response?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stubbed',
      json: async () => opts.response?.body,
    } as Response;
  }) as typeof fetch;

  return {
    ctx,
    calls,
    storeReads: () => storeReads,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

installProviderPlugins();

const catalog = { data: [{ id: 'gpt-x' }, { id: 'llama-3', name: 'Llama 3' }] };

test('buildModelListURL: joins an API root and the plugin path', () => {
  assert.equal(
    buildModelListURL('https://api.openai.com/v1/', '/models'),
    'https://api.openai.com/v1/models',
  );
  assert.equal(
    buildModelListURL('http://localhost:11434/v1', 'models'),
    'http://localhost:11434/v1/models',
  );
  assert.throws(() => buildModelListURL('', '/models'), /no base URL/i);
});

test('builtin modelList: declares endpoint + key requirement per type', () => {
  assert.equal(modelListRequiresApiKey('openai'), true);
  assert.equal(modelListRequiresApiKey('openrouter'), false);
  assert.equal(modelListRequiresApiKey('openai-compatible'), false);
  assert.equal(openrouterPlugin.modelList.defaultBaseURL, 'https://openrouter.ai/api/v1');
  assert.equal(openaiCompatiblePlugin.modelList.defaultBaseURL, undefined);
});

test('listRemoteModels: an explicit apiKey is a live fetch and skips the store', async () => {
  const f = fixture({
    stored: [
      {
        id: 'p-a',
        type: 'openai',
        apiKey: 'sk-from-db',
        baseURL: null,
        updatedAt: new Date('2026-02-01'),
      },
    ],
    response: { body: catalog },
  });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openai', apiKey: 'sk-param' });
    assert.equal(res.keySource, 'param');
    assert.equal(f.storeReads(), 0);
    assert.equal(f.calls[0]?.url, 'https://api.openai.com/v1/models');
    assert.equal(f.calls[0]?.headers.Authorization, 'Bearer sk-param');
    assert.deepEqual(res.models, [
      {
        modelId: 'gpt-x',
        displayName: null,
        contextLength: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        capabilities: null,
      },
      {
        modelId: 'llama-3',
        displayName: 'Llama 3',
        contextLength: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        capabilities: null,
      },
    ]);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: without an apiKey it falls back to a stored provider of that type', async () => {
  const f = fixture({
    stored: [
      {
        id: 'p-old',
        type: 'openai',
        apiKey: 'sk-old',
        baseURL: 'https://legacy.example.com/v1',
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'p-new',
        type: 'openai',
        apiKey: 'sk-new',
        baseURL: 'https://api.openai.com/v1',
        updatedAt: new Date('2026-03-01'),
      },
      {
        id: 'p-r',
        type: 'openrouter',
        apiKey: 'sk-other',
        baseURL: null,
        updatedAt: new Date('2026-09-09'),
      },
    ],
    response: { body: catalog },
  });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openai' });
    assert.equal(res.keySource, 'stored');
    assert.equal(f.calls[0]?.url, 'https://api.openai.com/v1/models');
    assert.equal(f.calls[0]?.headers.Authorization, 'Bearer sk-new');
  } finally {
    f.restore();
  }
});

test('listRemoteModels: an explicit baseURL overrides the stored instance root', async () => {
  const f = fixture({
    stored: [
      {
        id: 'p-new',
        type: 'openai',
        apiKey: 'sk-new',
        baseURL: 'https://api.openai.com/v1',
        updatedAt: new Date('2026-03-01'),
      },
    ],
    response: { body: catalog },
  });
  try {
    await listRemoteModels(f.ctx, {
      providerType: 'openai',
      baseURL: 'https://proxy.internal/v1',
    });
    assert.equal(f.calls[0]?.url, 'https://proxy.internal/v1/models');
  } finally {
    f.restore();
  }
});

test('listRemoteModels: openrouter is readable keyless with nothing stored', async () => {
  const f = fixture({ response: { body: catalog } });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openrouter' });
    assert.equal(res.keySource, 'none');
    assert.equal(res.modelUrl, 'https://openrouter.ai/api/v1/models');
    assert.equal(f.calls[0]?.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: providerId resolves that exact instance and skips the type lookup', async () => {
  const f = fixture({
    stored: [
      {
        id: 'p-old',
        type: 'openai',
        apiKey: 'sk-old',
        baseURL: 'https://old.example.com/v1',
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'p-new',
        type: 'openai',
        apiKey: 'sk-new',
        baseURL: 'https://api.openai.com/v1',
        updatedAt: new Date('2026-03-01'),
      },
    ],
    response: { body: catalog },
  });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openai', providerId: 'p-old' });
    assert.equal(res.keySource, 'stored');
    assert.equal(f.calls[0]?.url, 'https://old.example.com/v1/models');
    assert.equal(f.calls[0]?.headers.Authorization, 'Bearer sk-old');
    assert.equal(f.storeReads(), 1);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: providerId keeps an explicit key and the stored base URL', async () => {
  const f = fixture({
    stored: [
      {
        id: 'p-new',
        type: 'openai',
        apiKey: 'sk-new',
        baseURL: 'https://api.openai.com/v1',
        updatedAt: new Date('2026-03-01'),
      },
    ],
    response: { body: catalog },
  });
  try {
    const res = await listRemoteModels(f.ctx, {
      providerType: 'openai',
      providerId: 'p-new',
      apiKey: 'sk-param',
    });
    assert.equal(res.keySource, 'param');
    assert.equal(f.calls[0]?.url, 'https://api.openai.com/v1/models');
    assert.equal(f.calls[0]?.headers.Authorization, 'Bearer sk-param');
  } finally {
    f.restore();
  }
});

test('listRemoteModels: a providerId of another type is rejected before any request', async () => {
  const f = fixture({
    stored: [
      { id: 'p-r', type: 'openrouter', apiKey: null, baseURL: null, updatedAt: new Date() },
    ],
  });
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openai', providerId: 'p-r' }),
      ValidationError,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: an unknown providerId surfaces as not found', async () => {
  const f = fixture({});
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openai', providerId: 'missing' }),
      (err: unknown) => err instanceof ProviderNotFoundError && err.statusCode === 404,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: maps context, token limits and capabilities from a rich catalog', async () => {
  const richCatalog = {
    data: [
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        context_length: 200000,
        top_provider: { context_length: 200000, max_completion_tokens: 8192 },
        supported_parameters: ['tools', 'structured_outputs', 'reasoning'],
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        reasoning: { supported_efforts: ['low', 'high'], mandatory: false },
      },
    ],
  };
  const f = fixture({ response: { body: richCatalog } });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openrouter' });
    assert.deepEqual(res.models[0], {
      modelId: 'anthropic/claude-3.5-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      contextLength: 200000,
      maxInputTokens: 191808,
      maxOutputTokens: 8192,
      capabilities: {
        reasoning: true,
        toolCalling: true,
        structuredOutput: true,
        vision: true,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      },
    });
  } finally {
    f.restore();
  }
});

test('listRemoteModels: derives input limits and honors explicit input limits', async () => {
  const localCatalog = {
    data: [
      { id: 'local-model', max_model_len: 32768, max_output_tokens: 4096 },
      {
        id: 'explicit-input',
        context_length: 100000,
        max_input_tokens: 95000,
        max_output_tokens: 5000,
      },
    ],
  };
  const f = fixture({ response: { body: localCatalog } });
  try {
    const res = await listRemoteModels(f.ctx, {
      providerType: 'openai-compatible',
      baseURL: 'http://localhost:8000/v1',
    });
    assert.equal(res.models[0]?.contextLength, 32768);
    assert.equal(res.models[0]?.maxInputTokens, 28672);
    assert.equal(res.models[0]?.maxOutputTokens, 4096);
    assert.equal(res.models[1]?.maxInputTokens, 95000);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: duplicate rows merge missing metadata', async () => {
  const duplicateCatalog = {
    data: [
      { id: 'dup', context_length: 100000 },
      { id: 'dup', max_output_tokens: 10000, name: 'Dup' },
    ],
  };
  const f = fixture({ response: { body: duplicateCatalog } });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openrouter' });
    assert.equal(res.models.length, 1);
    assert.equal(res.models[0]?.displayName, 'Dup');
    assert.equal(res.models[0]?.contextLength, 100000);
    assert.equal(res.models[0]?.maxOutputTokens, 10000);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: models.dev fills missing OpenAI metadata and matches dated ids', async () => {
  const devModels = new Map<string, ModelsDevModel>([
    [
      'gpt-4o',
      {
        displayName: 'GPT-4o',
        contextLength: 128000,
        maxInputTokens: 112000,
        maxOutputTokens: 16384,
        capabilities: {
          reasoning: false,
          toolCalling: true,
          structuredOutput: true,
          vision: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
        },
      },
    ],
  ]);
  const f = fixture({
    stored: [
      { id: 'p-openai', type: 'openai', apiKey: 'sk', baseURL: null, updatedAt: new Date() },
    ],
    response: { body: { data: [{ id: 'gpt-4o-2024-08-06' }] } },
    modelsDev: devModels,
  });
  try {
    const res = await listRemoteModels(f.ctx, {
      providerType: 'openai',
      providerId: 'p-openai',
    });
    assert.deepEqual(res.models[0], {
      modelId: 'gpt-4o-2024-08-06',
      displayName: 'GPT-4o',
      contextLength: 128000,
      maxInputTokens: 112000,
      maxOutputTokens: 16384,
      capabilities: {
        reasoning: false,
        toolCalling: true,
        structuredOutput: true,
        vision: true,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      },
    });
  } finally {
    f.restore();
  }
});

test('listRemoteModels: models.dev never overrides metadata the provider already returned', async () => {
  const devModels = new Map<string, ModelsDevModel>([
    [
      'gpt-4o',
      {
        displayName: 'GPT-4o from models.dev',
        contextLength: 128000,
        maxInputTokens: 112000,
        maxOutputTokens: 16384,
        capabilities: {
          reasoning: true,
          toolCalling: true,
          structuredOutput: true,
          vision: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
        },
      },
    ],
  ]);
  const f = fixture({
    response: {
      body: {
        data: [
          {
            id: 'gpt-4o',
            name: 'Provider Label',
            context_length: 64000,
            max_output_tokens: 4096,
          },
        ],
      },
    },
    modelsDev: devModels,
  });
  try {
    const res = await listRemoteModels(f.ctx, { providerType: 'openai', apiKey: 'sk' });
    assert.equal(res.models[0]?.displayName, 'Provider Label');
    assert.equal(res.models[0]?.contextLength, 64000);
    assert.equal(res.models[0]?.maxInputTokens, 59904);
    assert.equal(res.models[0]?.maxOutputTokens, 4096);
    assert.equal(res.models[0]?.capabilities?.toolCalling, true);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: a key-required endpoint fails before any request is made', async () => {
  const f = fixture({});
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openai' }),
      (err: unknown) => err instanceof AuthError && err.status === 401,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: an unknown provider type is rejected', async () => {
  const f = fixture({});
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'not-a-plugin' }),
      ValidationError,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: openai-compatible without any base URL is a validation error', async () => {
  const f = fixture({});
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openai-compatible', apiKey: 'never-mind' }),
      (err: unknown) => err instanceof ValidationError,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('listRemoteModels: a key rejected by the provider surfaces as unauthorized', async () => {
  const f = fixture({
    stored: [
      { id: 'p-bad', type: 'openai', apiKey: 'sk-bad', baseURL: null, updatedAt: new Date() },
    ],
    response: { status: 401, body: {} },
  });
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openai' }),
      (err: unknown) => err instanceof AuthError,
    );
  } finally {
    f.restore();
  }
});

test('listRemoteModels: a server-side failure surfaces as provider unavailable', async () => {
  const f = fixture({ response: { status: 500, body: {} } });
  try {
    await assert.rejects(
      () => listRemoteModels(f.ctx, { providerType: 'openrouter' }),
      (err: unknown) => err instanceof AppError && err.status === 503,
    );
  } finally {
    f.restore();
  }
});

test('stdio: list.remote-model is registered and validates the combined params object', () => {
  const method = providerMethods['list.remote-model'];
  assert.equal(method?.kind, 'plain');
  assert.deepEqual(
    RemoteModelsRequestSchema.parse({ providerType: 'openrouter', apiKey: 'sk-1' }),
    { providerType: 'openrouter', apiKey: 'sk-1' },
  );
  assert.throws(() => RemoteModelsRequestSchema.parse({ apiKey: 'sk-1' }));
  assert.deepEqual(
    RemoteModelsRequestSchema.parse({ providerType: 'openai', providerId: 'p-1' }),
    { providerType: 'openai', providerId: 'p-1' },
  );
  assert.deepEqual(RemoteModelsBodySchema.parse({ providerId: 'p-1' }), { providerId: 'p-1' });
});
