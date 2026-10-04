import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import type { RunRecord } from '../../src/runs/index.js';

export async function listMessageRuns(
  ctx: Container,
  params: { workspaceId: string; chatId: string },
): Promise<RunRecord[]> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  return ctx.runService.listByChat(params.chatId);
}
