import type { Chat } from '../../../src/chat/index.js';

export interface ChatDTO {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  systemPrompt: string | null;
  thinkingMode: string;
  mode: 'ask' | 'plan' | 'edit';
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export function toChatDTO(chat: Chat): ChatDTO {
  return {
    id: chat.id,
    title: chat.title,
    providerId: chat.provider_id,
    modelId: chat.model_id,
    systemPrompt: chat.system_prompt,
    thinkingMode: chat.thinking_mode,
    mode: chat.mode,
    workspaceId: chat.workspace_id,
    createdAt: chat.created_at.toISOString(),
    updatedAt: chat.updated_at.toISOString(),
  };
}
