import { z } from 'zod';
import {
  listProviders,
  listProviderTypes,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listModels,
  listRemoteModels,
  createModel,
  updateModel,
  deleteModel,
} from '../../actions/index.js';
import {
  LlmProviderCreateSchema,
  LlmProviderUpdateSchema,
  ModelUpdateSchema,
  ProviderIdParamsSchema,
  ModelsParamsSchema,
  CreateModelBodySchema,
  RemoteModelsRequestSchema,
} from '../../validators/provider.js';
import { act, idParam, noParams, patchParams, IdSchema, type StdioMethod } from './types.js';

export const providerMethods: Record<string, StdioMethod> = {
  // # Provider
  'list.provider': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => listProviders(ctx),
  },
  'list.provider-types': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => listProviderTypes(ctx),
  },
  'get.provider': {
    kind: 'plain',
    validate: (p) => ProviderIdParamsSchema.parse(p),
    run: act(getProvider),
  },
  'create.provider': {
    kind: 'plain',
    validate: (p) => LlmProviderCreateSchema.parse(p),
    run: act(createProvider),
  },
  'update.provider': {
    kind: 'plain',
    validate: (p) => patchParams(LlmProviderUpdateSchema).parse(p),
    run: act(updateProvider),
  },
  'delete.provider': {
    kind: 'plain',
    validate: (p) => idParam.parse(p),
    run: act(deleteProvider),
  },

  // # Model
  'list.model': {
    kind: 'plain',
    validate: (p) => ModelsParamsSchema.parse(p),
    run: act(listModels),
  },
  'list.remote-model': {
    kind: 'plain',
    validate: (p) => RemoteModelsRequestSchema.parse(p),
    run: act(listRemoteModels),
  },
  'create.model': {
    kind: 'plain',
    validate: (p) => z.object({ providerId: IdSchema, input: CreateModelBodySchema }).parse(p),
    run: act(createModel),
  },
  'update.model': {
    kind: 'plain',
    validate: (p) => patchParams(ModelUpdateSchema).parse(p),
    run: act(updateModel),
  },
  'delete.model': {
    kind: 'plain',
    validate: (p) => idParam.parse(p),
    run: act(deleteModel),
  },
};
