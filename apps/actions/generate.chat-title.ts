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

export async function generateChatTitle(
  ctx: Container,
  params: GenerateChatTitleParams,
): Promise<ChatDTO> {
  if (!params.workspaceId) throw new ValidationError('workspaceId is required');
  if (!params.chatId) throw new ValidationError('chatId is required');
  if (!params.text || !params.text.trim()) throw new ValidationError('text is required');

  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  // Only the chat's first turn gets an auto title. Count user turns rather
  // than total rows: the first message is usually already persisted by the
  // time this runs (the send and this call race), so a raw row count would
  // reject every legitimate first-turn request.
  const history = await ctx.messagesService.loadHistory(params.chatId);
  const userTurns = history.filter((m) => m.role === 'user').length;
  if (userTurns > 1) {
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

    // Streamed, not `agent.object`: some OpenAI-compatible providers only
    // answer reliably on the streaming path, where the structured-object call
    // fails and silently drops to the static fallback title.
    const result = await ctx.agent.stream({
      model: resolved.data,
      system:
        'You write concise, descriptive chat titles. ' +
        'Reply with only the title on a single line. ' +
        'At most 10 words, never more than 15. ' +
        'Plain words only, no quotes, no markdown, no emojis, no trailing punctuation. ' +
        'Match the language of the user message.',
      messages: [{ role: 'user', content: params.text.slice(0, 2000) }],
      abortSignal: AbortSignal.timeout(20_000),
    });

    let raw = '';
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') raw += part.text;
    }
    generated = sanitizeTitle(raw);
  } catch (err) {
    // The static fallback below is the user-visible result, so log the cause.
    ctx.logger.warn(
      { err, chatId: params.chatId },
      'generateChatTitle: AI title failed, using fallback',
    );
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
