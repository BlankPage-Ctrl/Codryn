import type {
  LlmProvider,
  LlmProviderCreateInput,
  LlmProviderUpdateInput,
  Model,
  ModelCreateInput,
  ModelUpdateInput,
  ProviderModelList,
  ProviderTypeInfo,
  ProviderWithModels,
} from './types.js';
import type { ProviderStore } from './store.js';
import { getProviderPlugin, listProviderTypes } from './registry.js';
import { ModelNotFoundError, ProviderNotFoundError } from './errors.js';

function maskApiKey(input: ProviderWithModels): ProviderWithModels {
  const { apiKey, ...rest } = input;
  return {
    ...rest,
    apiKey: apiKey ? `***${apiKey.slice(-4)}` : null,
  };
}

export class ProviderService {
  constructor(private readonly store: ProviderStore) {}

  listProviderTypes(): ProviderTypeInfo[] {
    return listProviderTypes();
  }

  getModelListEndpoint(type: string): ProviderModelList | null {
    return getProviderPlugin(type)?.modelList ?? null;
  }

  async findProviderByType(type: string): Promise<LlmProvider | null> {
    return this.store.findMostRecentByType(type);
  }

  async findAll(): Promise<ProviderWithModels[]> {
    const providers = await this.store.findAllWithModels();
    return providers.map(maskApiKey);
  }

  async findOne(id: string): Promise<ProviderWithModels> {
    const provider = await this.store.findByIdWithModels(id);
    if (!provider) throw new ProviderNotFoundError(id);
    return maskApiKey(provider);
  }

  async create(input: LlmProviderCreateInput): Promise<LlmProvider> {
    return this.store.create(input);
  }

  async update(id: string, input: LlmProviderUpdateInput): Promise<LlmProvider> {
    const existing = await this.store.findById(id);
    if (!existing) throw new ProviderNotFoundError(id);
    return this.store.update(id, input);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.store.findById(id);
    if (!existing) throw new ProviderNotFoundError(id);
    await this.store.remove(id);
  }

  async findModelsByProviderId(providerId: string): Promise<Model[]> {
    return this.store.findModelsByProviderId(providerId);
  }

  async createModel(input: ModelCreateInput): Promise<Model> {
    return this.store.createModel(input);
  }

  async updateModel(id: string, input: ModelUpdateInput): Promise<Model> {
    const existing = await this.store.findModelById(id);
    if (!existing) throw new ModelNotFoundError(id);
    return this.store.updateModel(id, input);
  }

  async removeModel(id: string): Promise<void> {
    const existing = await this.store.findModelById(id);
    if (!existing) throw new ModelNotFoundError(id);
    await this.store.removeModel(id);
  }
}
