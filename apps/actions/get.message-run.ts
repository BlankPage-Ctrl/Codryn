import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import type { RunRecord } from '../../src/runs/index.js';

export async function getMessageRun(
  ctx: Container,
  params: { workspaceId: string; chatId: string; runId: string },
): Promise<RunRecord> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  const run = await ctx.runService.get(params.runId);
  if (!run || run.chatId !== params.chatId)
    throw new NotFoundError(`Run ${params.runId} not found`);
  return run;
}
