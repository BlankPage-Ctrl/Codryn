import {
  ChatCreateSchema,
  ChatUpdateSchema,
  type Chat,
  type ChatCreateInput,
  type ChatUpdateInput,
  type IChatService,
  type IChatRepository,
} from '../types/index.js';
import { ValidationError } from '../errors/validation.js';
import { ChatNotFoundError } from '../errors/not-found.js';

export class ChatService implements IChatService {
  constructor(private readonly repo: IChatRepository) {}

  async findAllByWorkspace(workspaceId: string): Promise<Chat[]> {
    return this.repo.findAllByWorkspace(workspaceId);
  }

  async findOne(id: string, workspaceId: string): Promise<Chat | null> {
    return this.repo.findByIdAndWorkspace(id, workspaceId);
  }

  async create(workspaceId: string, input: ChatCreateInput): Promise<Chat> {
    const parsed = ChatCreateSchema.safeParse({
      ...input,
      workspace_id: workspaceId,
    });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chat: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, workspaceId },
      );
    }

    return this.repo.create(parsed.data);
  }

  async update(id: string, workspaceId: string, patch: ChatUpdateInput): Promise<Chat> {
    const existing = await this.repo.findByIdAndWorkspace(id, workspaceId);
    if (!existing) throw new ChatNotFoundError(id, { workspaceId });

    const parsed = ChatUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id, workspaceId },
      );
    }

    return this.repo.update(id, parsed.data);
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    const existing = await this.repo.findByIdAndWorkspace(id, workspaceId);
    if (!existing) throw new ChatNotFoundError(id, { workspaceId });

    await this.repo.delete(id);
  }
}
