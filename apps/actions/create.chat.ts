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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function buildFallbackChatTitle(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  return `Chat - ${date} - ${time}`;
}

export async function createChat(ctx: Container, params: CreateChatParams): Promise<ChatDTO> {
  const defaults = await getDefaultProviderGlobal(ctx);
  const input: ChatCreateInput = {
    title: params.title?.trim() ? params.title.trim() : buildFallbackChatTitle(),
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
