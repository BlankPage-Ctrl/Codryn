import { z } from 'zod';
import {
  LlmProviderCreateSchema,
  LlmProviderUpdateSchema,
  ModelCreateSchema,
  ModelUpdateSchema,
  type LlmProvider,
  type LlmProviderCreateInput,
  type LlmProviderUpdateInput,
  type Model,
  type ModelCreateInput,
  type ModelUpdateInput,
} from './types.js';
import { hasProviderPlugin, getProviderPlugin } from './registry.js';
import { ModelNotFoundError, ProviderNotFoundError, ProviderValidationError } from './errors.js';

/** Minimal KV surface - satisfied by src/settings SettingsService. */
export interface KeyValueSettings {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
}

const PROVIDERS_INDEX_KEY = 'providers.index';
const MODELS_INDEX_KEY = 'models.index';
const providerKey = (id: string) => `provider.${id}`;
const modelKey = (id: string) => `model.${id}`;

const StoredProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  apiKey: z.string().nullable(),
  baseURL: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const StoredModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  displayName: z.string().nullable(),
  providerId: z.string(),
  maxInputTokens: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function toProvider(raw: z.infer<typeof StoredProviderSchema>): LlmProvider {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

function toModel(raw: z.infer<typeof StoredModelSchema>): Model {
  return {
    ...raw,
    maxInputTokens: raw.maxInputTokens ?? null,
    maxOutputTokens: raw.maxOutputTokens ?? null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

export class ProviderStore {
  constructor(private readonly settings: KeyValueSettings) {}

  private async readIndex(key: string): Promise<string[]> {
    const raw = await this.settings.getValue(key);
    if (raw === null || raw === '') return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return z.array(z.string()).parse(parsed);
    } catch (err) {
      throw new ProviderValidationError(`Corrupt index ${key}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async writeIndex(key: string, ids: string[]): Promise<void> {
    await this.settings.setValue(key, JSON.stringify(ids));
  }

  private async readProviderRow(id: string): Promise<LlmProvider | null> {
    const raw = await this.settings.getValue(providerKey(id));
    if (raw === null || raw === '') return null;
    try {
      return toProvider(StoredProviderSchema.parse(JSON.parse(raw)));
    } catch (err) {
      throw new ProviderValidationError(`Invalid provider record ${id}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async readModelRow(id: string): Promise<Model | null> {
    const raw = await this.settings.getValue(modelKey(id));
    if (raw === null || raw === '') return null;
    try {
      return toModel(StoredModelSchema.parse(JSON.parse(raw)));
    } catch (err) {
      throw new ProviderValidationError(`Invalid model record ${id}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private assertKnownType(type: string): void {
    if (!hasProviderPlugin(type)) {
      throw new ProviderValidationError(
        `Unknown provider type: ${type}. Available: ${this.knownTypes()}`,
        { type },
      );
    }
  }

  private knownTypes(): string {
    // Lazy import avoided - registry is already imported; keep message simple.
    return 'see GET /providers/types';
  }

  private assertValidConfig(type: string, apiKey?: string, baseURL?: string): void {
    const plugin = getProviderPlugin(type);
    if (!plugin) return;
    // Strip undefined so community schemas can stay minimal/strict.
    const candidate: Record<string, string> = {};
    if (apiKey !== undefined) candidate.apiKey = apiKey;
    if (baseURL !== undefined) candidate.baseURL = baseURL;
    const parsed = plugin.configSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ProviderValidationError(
        `Invalid ${type} config: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, type },
      );
    }
  }

  async findAll(): Promise<LlmProvider[]> {
    const ids = await this.readIndex(PROVIDERS_INDEX_KEY);
    const out: LlmProvider[] = [];
    for (const id of ids) {
      const row = await this.readProviderRow(id);
      if (row) out.push(row);
    }
    return out;
  }

  async findById(id: string): Promise<LlmProvider | null> {
    return this.readProviderRow(id);
  }

  async create(data: LlmProviderCreateInput): Promise<LlmProvider> {
    const parsed = LlmProviderCreateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderValidationError(
        `Invalid provider: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    this.assertKnownType(parsed.data.type);
    this.assertValidConfig(parsed.data.type, parsed.data.apiKey, parsed.data.baseURL);

    const now = new Date().toISOString();
    const row: LlmProvider = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      type: parsed.data.type,
      apiKey: parsed.data.apiKey ?? null,
      baseURL: parsed.data.baseURL ?? null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    await this.settings.setValue(
      providerKey(row.id),
      JSON.stringify({ ...row, createdAt: now, updatedAt: now }),
    );
    const ids = await this.readIndex(PROVIDERS_INDEX_KEY);
    await this.writeIndex(PROVIDERS_INDEX_KEY, [...ids, row.id]);
    return row;
  }

  async update(id: string, data: LlmProviderUpdateInput): Promise<LlmProvider> {
    const parsed = LlmProviderUpdateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderValidationError(
        `Invalid provider update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id },
      );
    }
    const existing = await this.readProviderRow(id);
    if (!existing) throw new ProviderNotFoundError(id);

    const next = {
      ...existing,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.apiKey !== undefined ? { apiKey: parsed.data.apiKey } : {}),
      ...(parsed.data.baseURL !== undefined ? { baseURL: parsed.data.baseURL } : {}),
    };
    this.assertKnownType(next.type);
    this.assertValidConfig(next.type, next.apiKey ?? undefined, next.baseURL ?? undefined);

    const now = new Date().toISOString();
    const updated: LlmProvider = { ...next, updatedAt: new Date(now) };
    await this.settings.setValue(
      providerKey(id),
      JSON.stringify({
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: now,
      }),
    );
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.readProviderRow(id);
    if (!existing) throw new ProviderNotFoundError(id);
    // Cascade: delete models belonging to this provider.
    const models = await this.findModelsByProviderId(id);
    for (const m of models) {
      await this.removeModel(m.id);
    }
    await this.settings.setValue(providerKey(id), '');
    const ids = await this.readIndex(PROVIDERS_INDEX_KEY);
    await this.writeIndex(
      PROVIDERS_INDEX_KEY,
      ids.filter((x) => x !== id),
    );
  }

  async findAllWithModels(): Promise<(LlmProvider & { models: Model[] })[]> {
    const providers = await this.findAll();
    return Promise.all(
      providers.map(async (p) => ({ ...p, models: await this.findModelsByProviderId(p.id) })),
    );
  }

  async findByIdWithModels(id: string): Promise<(LlmProvider & { models: Model[] }) | null> {
    const provider = await this.readProviderRow(id);
    if (!provider) return null;
    return { ...provider, models: await this.findModelsByProviderId(id) };
  }

  async findModelById(id: string): Promise<Model | null> {
    return this.readModelRow(id);
  }

  async findModelsByProviderId(providerId: string): Promise<Model[]> {
    const ids = await this.readIndex(MODELS_INDEX_KEY);
    const out: Model[] = [];
    for (const id of ids) {
      const row = await this.readModelRow(id);
      if (row && row.providerId === providerId) out.push(row);
    }
    return out;
  }

  async createModel(data: ModelCreateInput): Promise<Model> {
    const parsed = ModelCreateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderValidationError(
        `Invalid model: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    const provider = await this.readProviderRow(parsed.data.providerId);
    if (!provider) throw new ProviderNotFoundError(parsed.data.providerId);

    const now = new Date().toISOString();
    const row: Model = {
      id: crypto.randomUUID(),
      modelId: parsed.data.modelId,
      displayName: parsed.data.displayName ?? null,
      providerId: parsed.data.providerId,
      maxInputTokens: parsed.data.maxInputTokens,
      maxOutputTokens: parsed.data.maxOutputTokens,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    await this.settings.setValue(
      modelKey(row.id),
      JSON.stringify({ ...row, createdAt: now, updatedAt: now }),
    );
    const ids = await this.readIndex(MODELS_INDEX_KEY);
    await this.writeIndex(MODELS_INDEX_KEY, [...ids, row.id]);
    return row;
  }

  async updateModel(id: string, data: ModelUpdateInput): Promise<Model> {
    const parsed = ModelUpdateSchema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderValidationError(
        `Invalid model update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id },
      );
    }
    const existing = await this.readModelRow(id);
    if (!existing) throw new ModelNotFoundError(id);

    const next: Model = {
      ...existing,
      ...(parsed.data.modelId !== undefined ? { modelId: parsed.data.modelId } : {}),
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.providerId !== undefined ? { providerId: parsed.data.providerId } : {}),
      ...(parsed.data.maxInputTokens !== undefined
        ? { maxInputTokens: parsed.data.maxInputTokens }
        : {}),
      ...(parsed.data.maxOutputTokens !== undefined
        ? { maxOutputTokens: parsed.data.maxOutputTokens }
        : {}),
    };
    if (next.providerId !== existing.providerId) {
      const target = await this.readProviderRow(next.providerId);
      if (!target) throw new ProviderNotFoundError(next.providerId);
    }
    const now = new Date().toISOString();
    const updated: Model = { ...next, updatedAt: new Date(now) };
    await this.settings.setValue(
      modelKey(id),
      JSON.stringify({
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: now,
      }),
    );
    return updated;
  }

  async removeModel(id: string): Promise<void> {
    const existing = await this.readModelRow(id);
    if (!existing) throw new ModelNotFoundError(id);
    await this.settings.setValue(modelKey(id), '');
    const ids = await this.readIndex(MODELS_INDEX_KEY);
    await this.writeIndex(
      MODELS_INDEX_KEY,
      ids.filter((x) => x !== id),
    );
  }
}
