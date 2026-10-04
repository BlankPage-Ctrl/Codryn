import type { Container } from '../bootstrap.js';
import type { ChatCreateInput } from '../../src/chat/index.js';
import { toChatDTO, type ChatDTO } from '../http/dto/chat.js';
import { getDefaultProviderGlobal } from '../shared/global-settings.js';

export interface CreateChatParams {
  workspaceId: string;
  title?: string;
  systemPrompt?: string;
  modelId?: string;
  providerId?: string;
  thinkingMode?: string;
  mode?: 'ask' | 'plan' | 'edit';
}

export async function createChat(ctx: Container, params: CreateChatParams): Promise<ChatDTO> {
  const defaults = await getDefaultProviderGlobal(ctx);
  const input: ChatCreateInput = {
    title: params.title ?? 'New Chat',
    system_prompt: params.systemPrompt,
    workspace_id: params.workspaceId,
    provider_id: params.providerId ?? defaults.providerId ?? undefined,
    model_id: params.modelId ?? defaults.modelId ?? undefined,
    thinking_mode: params.thinkingMode,
    mode: params.mode,
  };
  const chat = await ctx.chatService.create(params.workspaceId, input);
  return toChatDTO(chat);
}
