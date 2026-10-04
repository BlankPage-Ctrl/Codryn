import type { Container } from '../bootstrap.js';
import type { ChatUpdateInput } from '../../src/chat/index.js';
import { toChatDTO, type ChatDTO } from '../http/dto/chat.js';
import { NotFoundError } from '../shared/errors.js';

export interface UpdateChatParams {
  workspaceId: string;
  id: string;
  title?: string;
  systemPrompt?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  thinkingMode?: string;
  mode?: 'ask' | 'plan' | 'edit';
}

export async function updateChat(ctx: Container, params: UpdateChatParams): Promise<ChatDTO> {
  const patch: ChatUpdateInput = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.providerId !== undefined) patch.provider_id = params.providerId;
  if (params.modelId !== undefined) patch.model_id = params.modelId;
  if (params.systemPrompt !== undefined) patch.system_prompt = params.systemPrompt;
  if (params.thinkingMode !== undefined) patch.thinking_mode = params.thinkingMode;
  if (params.mode !== undefined) patch.mode = params.mode;

  try {
    const chat = await ctx.chatService.update(params.id, params.workspaceId, patch);
    return toChatDTO(chat);
  } catch {
    throw new NotFoundError(`Chat ${params.id} not found`);
  }
}
