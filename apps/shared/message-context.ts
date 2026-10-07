import type { UIMessage } from 'ai';
import { MessageAssembler, estimateInputTokens } from '../../src/messages/index.js';
import { MessagesDomainError } from '../../src/messages/errors/base.js';
import type { AgentMode } from '../agent/modes.js';
import { buildModeSystemPart, buildPlanNotice } from '../agent/modes.js';
import { findLatestPlanMeta } from './plan-store.js';
import { resolveMention, type SystemTextPart } from './mention.js';
import { AppError, ValidationError } from './errors.js';
import type { Container } from '../bootstrap.js';

export type ChatHistory = Awaited<ReturnType<Container['messagesService']['load']>>;

/** Loads chat history, mapping domain errors to the shared AppError contract. */
export async function loadChatHistory(ctx: Container, chatId: string): Promise<ChatHistory> {
  try {
    return await ctx.messagesService.load(chatId);
  } catch (err) {
    if (err instanceof MessagesDomainError) {
      if (err.code === 'VALIDATION_FAILED' || err.code === 'INVALID_INPUT') {
        throw new ValidationError(err.message);
      }
      throw new AppError(
        err.statusCode,
        err.message,
        err.code === 'NOT_FOUND' ? ('NOT_FOUND' as const) : 'INTERNAL_ERROR',
      );
    }
    throw err;
  }
}

export interface AssembledContext {
  context: MessageAssembler;
  userText: string;
}

/**
 * Merges history + the incoming user message, then appends the mode system
 * part. Returns the assembler and the extracted user text for mention parsing.
 */
export function assembleMessageContext(
  history: ChatHistory,
  message: UIMessage,
  mode: AgentMode,
): AssembledContext {
  const context = new MessageAssembler();
  context.merge(history);
  context.addMessage({
    id: message.id,
    role: message.role,
    metadata: message.metadata,
    parts: message.parts,
  });
  const userText = context.textOf(message.id);
  context.addPart(message.id, buildModeSystemPart(mode));
  return { context, userText };
}

/**
 * Edit mode only: looks up the latest plan and appends its reminder.
 * Fail-open - a lookup failure only logs and continues without the notice.
 */
export async function attachPlanNoticeSafe(
  ctx: Container,
  context: MessageAssembler,
  messageId: string,
  projectPath: string,
  chatId: string,
): Promise<void> {
  let planNotice: string | null = null;
  try {
    const latest = await findLatestPlanMeta(projectPath, chatId);
    planNotice = buildPlanNotice(latest);
  } catch (err) {
    ctx.logger.warn({ err, chatId }, 'plan lookup failed; continuing without plan notice');
  }
  if (planNotice) {
    const planSystemPart: SystemTextPart = { type: 'text', text: planNotice, isSystem: true };
    context.addPart(messageId, planSystemPart);
  }
}

/**
 * Resolves `@file`/`@folder`/`@symbol` mentions in the user text and appends the
 * resulting system part. Fail-open inside `resolveMention` (raw prompt).
 */
export async function attachMentionPart(
  ctx: Container,
  context: MessageAssembler,
  messageId: string,
  projectPath: string,
  userText: string,
  workspaceId?: string,
): Promise<void> {
  const { request, bysystemPart } = await resolveMention(
    ctx,
    projectPath,
    userText,
    {},
    workspaceId,
  );
  if (request) {
    ctx.logger.debug(
      {
        sensitive: true,
        participant: request.participant?.name ?? null,
        command: request.command,
        references: request.references.length,
      },
      'mention resolved',
    );
  }
  if (bysystemPart) {
    context.addPart(messageId, bysystemPart);
  }
}

/** Throws `ValidationError` when estimated input exceeds the model limit. */
export function assertInputTokenLimit(
  messages: Array<{ content?: unknown }>,
  maxInputTokens: number | null,
  modelLabel: string,
): void {
  if (maxInputTokens == null) return;
  const estimated = estimateInputTokens(messages);
  if (estimated > maxInputTokens) {
    throw new ValidationError(
      `Input ~${estimated} tokens exceeds maxInputTokens ${maxInputTokens} for model ${modelLabel}`,
    );
  }
}
