import type { ChatRow, NewChatRow } from '../schemas/index.js';

export interface IColdChatStorage {
  findById(id: string): Promise<ChatRow | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<ChatRow | null>;
  findAllByWorkspace(workspaceId: string): Promise<ChatRow[]>;
  insert(row: NewChatRow): Promise<ChatRow>;
  update(id: string, patch: Partial<NewChatRow>): Promise<ChatRow>;
  delete(id: string): Promise<void>;
}
