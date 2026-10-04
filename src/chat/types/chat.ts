import { z } from 'zod';

export const ChatModeSchema = z.enum(['ask', 'plan', 'edit']);
export type ChatMode = z.infer<typeof ChatModeSchema>;

export type Chat = {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  system_prompt: string | null;
  thinking_mode: string;
  mode: ChatMode;
  workspace_id: string;
  created_at: Date;
  updated_at: Date;
};

const IdSchema = z.string().min(1).max(64);

export const ChatCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  provider_id: IdSchema.optional(),
  model_id: IdSchema.optional(),
  system_prompt: z.string().max(10_000).optional(),
  thinking_mode: z.string().optional(),
  mode: ChatModeSchema.optional(),
  workspace_id: IdSchema,
});

export type ChatCreateInput = z.infer<typeof ChatCreateSchema>;

export const ChatUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    provider_id: IdSchema.nullable().optional(),
    model_id: IdSchema.nullable().optional(),
    system_prompt: z.string().max(10_000).nullable().optional(),
    thinking_mode: z.string().optional(),
    mode: ChatModeSchema.optional(),
  })
  .strict();

export type ChatUpdateInput = z.infer<typeof ChatUpdateSchema>;

export type ChatRowMapped = {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  systemPrompt: string | null;
  thinkingMode: string;
  mode: ChatMode;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};
