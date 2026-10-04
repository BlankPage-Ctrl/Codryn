import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import type { RunRecord } from '../../src/runs/index.js';

export async function cancelMessageRun(
  ctx: Container,
  params: { workspaceId: string; chatId: string; runId: string },
): Promise<RunRecord> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);
  const run = await ctx.runService.get(params.runId);
  if (!run || run.chatId !== params.chatId)
    throw new NotFoundError(`Run ${params.runId} not found`);
  if (run.status !== 'running') return run;
  ctx.runService.requestCancel(params.runId);
  const finished = await ctx.runService.finish(params.runId, 'cancelled', {
    code: 'RUN_ABORTED',
    message: 'Run cancelled by user',
  });
  return finished ?? run;
}
