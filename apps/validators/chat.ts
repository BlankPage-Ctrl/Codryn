import { z } from 'zod';

export const WorkspaceIdParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export const ChatParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

export const ChatModeSchema = z.enum(['ask', 'plan', 'edit']);

export const CreateChatSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    systemPrompt: z.string().max(10_000).optional(),
    modelId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    thinkingMode: z.string().optional(),
    mode: ChatModeSchema.optional(),
  })
  .strict();

export const UpdateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    systemPrompt: z.string().max(10_000).nullable().optional(),
    modelId: z.string().min(1).nullable().optional(),
    providerId: z.string().min(1).nullable().optional(),
    thinkingMode: z.string().optional(),
    mode: ChatModeSchema.optional(),
  })
  .strict();

export function validateWorkspaceId(params: unknown) {
  return WorkspaceIdParamsSchema.parse(params);
}

export function validateChatParams(params: unknown) {
  return ChatParamsSchema.parse(params);
}

export function validateCreateChat(body: unknown) {
  return CreateChatSchema.parse(body);
}

export function validateUpdateChat(body: unknown) {
  return UpdateChatSchema.parse(body);
}

export const GenerateChatTitleSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .strict();

export function validateGenerateChatTitle(body: unknown) {
  return GenerateChatTitleSchema.parse(body);
}
