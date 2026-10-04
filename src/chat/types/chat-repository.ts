import type { Chat, ChatCreateInput, ChatUpdateInput } from './chat.js';

export interface IChatRepository {
  findById(id: string): Promise<Chat | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<Chat | null>;
  findAllByWorkspace(workspaceId: string): Promise<Chat[]>;
  create(input: ChatCreateInput): Promise<Chat>;
  update(id: string, patch: ChatUpdateInput): Promise<Chat>;
  delete(id: string): Promise<void>;
}
