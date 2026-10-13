import { z } from 'zod';
import { zodSchema } from 'ai';
import type { Container } from '../bootstrap.js';
import { ValidationError, NotFoundError } from '../shared/errors.js';
import { resolveChatModel } from '../shared/model-resolver.js';
import { getDefaultProviderGlobal } from '../shared/global-settings.js';
import { toChatDTO, type ChatDTO } from '../http/dto/chat.js';
import { buildFallbackChatTitle } from './create.chat.js';

export interface GenerateChatTitleParams {
  workspaceId: string;
  chatId: string;
  text: string;
  providerId?: string;
  modelId?: string;
}

export interface GenerateChatTitleResult {
  title: string;
}

const titleSchema = z.object({
  title: z.string(),
});

function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let title = raw.trim().replace(/\s+/g, ' ');
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }
  title = title.replace(/[.,;:!?\-_]+$/u, '').trim();
  const words = title.split(' ').filter(Boolean);
  if (words.length > 15) title = words.slice(0, 15).join(' ');
  return title;
}

function countWords(title: string): number {
  return title.split(' ').filter(Boolean).length;
}

export async function generateChatTitle(
  ctx: Container,
  params: GenerateChatTitleParams,
): Promise<ChatDTO> {
  if (!params.workspaceId) throw new ValidationError('workspaceId is required');
  if (!params.chatId) throw new ValidationError('chatId is required');
  if (!params.text || !params.text.trim()) throw new ValidationError('text is required');

  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  const history = await ctx.messagesService.loadHistory(params.chatId);
  if (history.length > 2) {
    throw new ValidationError('Title can only be generated for a new chat');
  }

  let generated = '';
  try {
    const defaults = await getDefaultProviderGlobal(ctx);
    const resolved = await resolveChatModel(
      ctx,
      {
        provider_id: params.providerId ?? chat.provider_id ?? null,
        model_id: params.modelId ?? chat.model_id ?? null,
      },
      defaults,
    );
    if (!resolved.ok) throw new ValidationError(resolved.error.message);

    const result = await ctx.agent.object({
      model: resolved.data,
      system:
        'You write concise, descriptive chat titles. ' +
        'Produce a JSON object matching: { "title": string }. ' +
        'Title must be at most 10 words, never more than 15 words. ' +
        'Plain words only, no quotes, no emojis, no punctuation at the end. ' +
        'Match the language of the user message.',
      prompt: params.text.slice(0, 2000),
      schema: zodSchema(titleSchema),
    });

    const candidate = sanitizeTitle(result.object.title);
    if (candidate && countWords(candidate) <= 15) generated = candidate;
  } catch {
    // Fall through to the static fallback below.
  }
  const title = generated || buildFallbackChatTitle();

  try {
    const updated = await ctx.chatService.update(params.chatId, params.workspaceId, {
      title,
    });
    return toChatDTO(updated);
  } catch {
    throw new NotFoundError(`Chat ${params.chatId} not found`);
  }
}
