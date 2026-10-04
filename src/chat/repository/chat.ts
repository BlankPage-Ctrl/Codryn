import {
  ChatCreateSchema,
  ChatUpdateSchema,
  ChatModeSchema,
  type Chat,
  type ChatCreateInput,
  type ChatUpdateInput,
} from '../types/index.js';
import type { IChatRepository } from '../types/chat-repository.js';
import type { IColdChatStorage } from '../types/cold-chat-storage.js';
import { chatSelectSchema } from '../schemas/zod/index.js';
import type { z } from 'zod';
import { ValidationError } from '../errors/validation.js';
import { ChatDomainError } from '../errors/base.js';

type ChatRow = z.infer<typeof chatSelectSchema>;

function parseChatRow(row: unknown, context?: Record<string, unknown>): ChatRow {
  try {
    return chatSelectSchema.parse(row);
  } catch (err) {
    if (err instanceof ChatDomainError) throw err;
    throw new ValidationError('Invalid chat row from storage', {
      ...context,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

function rowToChat(row: ChatRow): Chat {
  const mode = ChatModeSchema.safeParse(row.mode);
  return {
    id: row.id,
    title: row.title,
    provider_id: row.providerId,
    model_id: row.modelId,
    system_prompt: row.systemPrompt,
    thinking_mode: row.thinkingMode,
    mode: mode.success ? mode.data : 'ask',
    workspace_id: row.workspaceId,
    created_at: new Date(row.createdAt),
    updated_at: new Date(row.updatedAt),
  };
}

export class ChatRepository implements IChatRepository {
  constructor(private readonly cold: IColdChatStorage) {}

  async findById(id: string): Promise<Chat | null> {
    const row = await this.cold.findById(id);
    if (!row) return null;
    const validated = parseChatRow(row, { id });
    return rowToChat(validated);
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<Chat | null> {
    const row = await this.cold.findByIdAndWorkspace(id, workspaceId);
    if (!row) return null;
    const validated = parseChatRow(row, { id, workspaceId });
    return rowToChat(validated);
  }

  async findAllByWorkspace(workspaceId: string): Promise<Chat[]> {
    const rows = await this.cold.findAllByWorkspace(workspaceId);
    return rows.map((row) =>
      rowToChat(parseChatRow(row, { id: (row as { id?: unknown }).id, workspaceId })),
    );
  }

  async create(input: ChatCreateInput): Promise<Chat> {
    const parsed = ChatCreateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chat: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    const now = new Date().toISOString();

    const row = await this.cold.insert({
      id: crypto.randomUUID(),
      title: parsed.data.title,
      providerId: parsed.data.provider_id ?? null,
      modelId: parsed.data.model_id ?? null,
      systemPrompt: parsed.data.system_prompt ?? null,
      thinkingMode: parsed.data.thinking_mode ?? 'default',
      mode: parsed.data.mode ?? 'ask',
      workspaceId: parsed.data.workspace_id,
      createdAt: now,
      updatedAt: now,
    });

    const validated = parseChatRow(row, { id: (row as { id?: unknown }).id });
    return rowToChat(validated);
  }

  async update(id: string, patch: ChatUpdateInput): Promise<Chat> {
    const parsed = ChatUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid chat update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id },
      );
    }
    const rowPatch: Partial<ChatRow> = {};

    if (parsed.data.title !== undefined) rowPatch.title = parsed.data.title;
    if (parsed.data.provider_id !== undefined) rowPatch.providerId = parsed.data.provider_id;
    if (parsed.data.model_id !== undefined) rowPatch.modelId = parsed.data.model_id;
    if (parsed.data.system_prompt !== undefined) rowPatch.systemPrompt = parsed.data.system_prompt;
    if (parsed.data.thinking_mode !== undefined) rowPatch.thinkingMode = parsed.data.thinking_mode;
    if (parsed.data.mode !== undefined) rowPatch.mode = parsed.data.mode;

    const row = await this.cold.update(id, rowPatch);
    const validated = parseChatRow(row, { id });
    return rowToChat(validated);
  }

  async delete(id: string): Promise<void> {
    await this.cold.delete(id);
  }
}
