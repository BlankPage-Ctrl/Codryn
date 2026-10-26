import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Container } from '../../apps/bootstrap.js';
import { AppError, AuthError, ValidationError } from '../../apps/shared/errors.js';
import { buildModelListURL, modelListRequiresApiKey } from '../../apps/providers/model-list.js';
import { installProviderPlugins } from '../../apps/providers/registry.js';
import { openaiPlugin } from '../../apps/providers/builtin/openai.js';
import { openrouterPlugin } from '../../apps/providers/builtin/openrouter.js';
import { openaiCompatiblePlugin } from '../../apps/providers/builtin/openai-compatible.js';
import { RemoteModelsRequestSchema } from '../../apps/validators/provider.js';
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
      { modelId: 'gpt-x', displayName: null },
      { modelId: 'llama-3', displayName: 'Llama 3' },
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
  assert.throws(() =>
    RemoteModelsRequestSchema.parse({ providerType: 'openai', providerId: 'p-1' }),
  );
});
