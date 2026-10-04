import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  listProviders,
  listProviderTypes,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listModels,
  createModel,
  updateModel,
  deleteModel,
} from '../../actions/index.js';
import {
  validateProviderId,
  validateModelsParams,
  validateModelParams,
  validateCreateProvider,
  validateUpdateProvider,
  validateCreateModel,
  validateUpdateModel,
} from '../../validators/provider.js';

export function registerProviderRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/providers', async () => listProviders(ctx));

  app.get('/providers/types', async () => listProviderTypes(ctx));

  app.get('/providers/:id', async (req) => {
    const { id } = validateProviderId(req.params);
    return getProvider(ctx, { id });
  });

  app.post('/providers', async (req, reply) => {
    const input = validateCreateProvider(req.body);
    const provider = await createProvider(ctx, input);
    return reply.code(201).send(provider);
  });

  app.patch('/providers/:id', async (req) => {
    const { id } = validateProviderId(req.params);
    const patch = validateUpdateProvider(req.body);
    return updateProvider(ctx, { id, patch });
  });

  app.delete('/providers/:id', async (req, reply) => {
    const { id } = validateProviderId(req.params);
    await deleteProvider(ctx, { id });
    return reply.code(204).send();
  });

  app.get('/providers/:providerId/models', async (req) => {
    const { providerId } = validateModelsParams(req.params);
    return listModels(ctx, { providerId });
  });

  app.post('/providers/:providerId/models', async (req, reply) => {
    const { providerId } = validateModelsParams(req.params);
    const input = validateCreateModel(req.body);
    const model = await createModel(ctx, { providerId, input });
    return reply.code(201).send(model);
  });

  app.patch('/providers/:providerId/models/:id', async (req) => {
    const { id } = validateModelParams(req.params);
    const patch = validateUpdateModel(req.body);
    return updateModel(ctx, { id, patch });
  });

  app.delete('/providers/:providerId/models/:id', async (req, reply) => {
    const { id } = validateModelParams(req.params);
    await deleteModel(ctx, { id });
    return reply.code(204).send();
  });
}
