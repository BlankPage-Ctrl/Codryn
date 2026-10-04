import { z } from 'zod';
import type { ReasoningOptions, ProviderConfig } from '../../src/agent/types/index.js';
import type { ResolveClientFactory, ProviderModelFactory } from '../../src/agent/types/index.js';
import type { ReasoningBuildArgs } from './reasoning/builders/shared.js';

export type ReasoningBuildContext = ReasoningBuildArgs;

/** Model-factory shape the agent accepts - plugins must return this. */
export type { ResolveClientFactory as ProviderClientFactory, ProviderModelFactory };

// ---------------------------------------------------------------------------
// Stored entities (persisted as JSON via src/settings KV, one key per record)
// ---------------------------------------------------------------------------

export interface LlmProvider {
  id: string;
  name: string;
  /** Plugin id, e.g. 'openai' | 'openai-compatible' | 'openrouter' | custom. */
  type: string;
  apiKey: string | null;
  baseURL: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Model {
  id: string;
  modelId: string;
  displayName: string | null;
  providerId: string;
  /** Max input tokens gate (null = unlimited). Enforced pre-run via estimator. */
  maxInputTokens: number | null;
  /** Max output tokens passed to the LLM (null = provider default). */
  maxOutputTokens: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderWithModels extends LlmProvider {
  models: Model[];
}

export const LlmProviderCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(60),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
  })
  .strict();

export type LlmProviderCreateInput = z.infer<typeof LlmProviderCreateSchema>;

export const LlmProviderUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: z.string().trim().min(1).max(60).optional(),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
  })
  .strict();

export type LlmProviderUpdateInput = z.infer<typeof LlmProviderUpdateSchema>;

const TokenLimitSchema = z.number().int().positive().max(1_000_000).nullable().optional();

export const ModelCreateSchema = z
  .object({
    modelId: z.string().trim().min(1),
    displayName: z.string().trim().optional(),
    providerId: z.string().min(1),
    maxInputTokens: TokenLimitSchema,
    maxOutputTokens: TokenLimitSchema,
  })
  .strict();

export type ModelCreateInput = z.infer<typeof ModelCreateSchema>;

export const ModelUpdateSchema = z
  .object({
    modelId: z.string().trim().min(1).optional(),
    displayName: z.string().trim().optional(),
    providerId: z.string().min(1).optional(),
    maxInputTokens: TokenLimitSchema,
    maxOutputTokens: TokenLimitSchema,
  })
  .strict();

export type ModelUpdateInput = z.infer<typeof ModelUpdateSchema>;

// ---------------------------------------------------------------------------
// Provider Plugin contract
// ---------------------------------------------------------------------------
//
// A plugin defines a provider *type* (how to talk to an LLM API). User-created
// provider *instances* (name, apiKey, baseURL) are stored in settings KV and
// reference a plugin via `type`.
//
// Official plugins ship in `apps/providers/builtin/`.
// Community plugins go in `apps/providers/community/<id>/` and call
// `registerProviderPlugin()` (see registry.ts) - no changes to src/ needed.

/** Foreign provider shape (store record) - translated to ProviderConfig before entering src/agent. */
export interface ProviderLike {
  id: string;
  name: string;
  type: string;
  apiKey?: string | null;
  baseURL?: string | null;
}

export type { ReasoningBuildArgs } from './reasoning/builders/shared.js';

export interface ProviderPlugin {
  /** Unique type id referenced by LlmProvider.type. */
  readonly id: string;
  readonly label: string;
  readonly isOfficial: boolean;
  /** Whether instances of this type must set baseURL (shown prominently in UIs). */
  readonly requiresBaseURL: boolean;
  /** Validates instance config (apiKey/baseURL/extra) on create/update. */
  readonly configSchema: z.ZodTypeAny;
  /** Builds an AI SDK model factory from a stored instance config. */
  createClient(config: ProviderConfig): ProviderModelFactory;
  /** Builds reasoning/thinking options. Omit to use the portable default. */
  buildReasoningOptions?(ctx: ReasoningBuildContext): ReasoningOptions;
}

export interface ProviderTypeInfo {
  id: string;
  label: string;
  isOfficial: boolean;
  requiresBaseURL: boolean;
}
