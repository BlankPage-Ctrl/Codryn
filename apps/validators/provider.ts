import { z } from 'zod';
import {
  LlmProviderCreateSchema,
  LlmProviderUpdateSchema,
  ModelCreateSchema,
  ModelUpdateSchema,
} from '../providers/index.js';

export { LlmProviderCreateSchema, LlmProviderUpdateSchema, ModelCreateSchema, ModelUpdateSchema };

export const ProviderIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const ModelsParamsSchema = z.object({
  providerId: z.string().min(1),
});

export const ModelParamsSchema = z.object({
  providerId: z.string().min(1),
  id: z.string().min(1),
});

export const CreateModelBodySchema = ModelCreateSchema.omit({ providerId: true });

export const RemoteModelsParamsSchema = z.object({
  providerType: z.string().trim().min(1).max(60),
});

export const RemoteModelsBodySchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    baseURL: z.string().trim().min(1).optional(),
  })
  .strict();

export const RemoteModelsRequestSchema = z
  .object({
    providerType: z.string().trim().min(1).max(60),
    apiKey: z.string().trim().min(1).optional(),
    baseURL: z.string().trim().min(1).optional(),
  })
  .strict();

export function validateProviderId(params: unknown) {
  return ProviderIdParamsSchema.parse(params);
}

export function validateModelsParams(params: unknown) {
  return ModelsParamsSchema.parse(params);
}

export function validateModelParams(params: unknown) {
  return ModelParamsSchema.parse(params);
}

export function validateCreateProvider(body: unknown) {
  return LlmProviderCreateSchema.parse(body);
}

export function validateUpdateProvider(body: unknown) {
  return LlmProviderUpdateSchema.parse(body);
}

export function validateCreateModel(body: unknown) {
  return CreateModelBodySchema.parse(body);
}

export function validateUpdateModel(body: unknown) {
  return ModelUpdateSchema.parse(body);
}

export function validateRemoteModelsParams(params: unknown) {
  return RemoteModelsParamsSchema.parse(params);
}

export function validateRemoteModelsBody(body: unknown) {
  return RemoteModelsBodySchema.parse(body);
}
