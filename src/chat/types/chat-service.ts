import type { Chat, ChatCreateInput, ChatUpdateInput } from './chat.js';

export interface IChatService {
  findAllByWorkspace(workspaceId: string): Promise<Chat[]>;
  findOne(id: string, workspaceId: string): Promise<Chat | null>;
  create(workspaceId: string, input: ChatCreateInput): Promise<Chat>;
  update(id: string, workspaceId: string, patch: ChatUpdateInput): Promise<Chat>;
  delete(id: string, workspaceId: string): Promise<void>;
}
