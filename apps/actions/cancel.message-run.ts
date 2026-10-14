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
  // Sub-agents share the parent run signal, so the cancel above also aborts a
  // running delegate_task. LLM abort is cooperative, only shells get SIGKILL.
  // Best-effort: SIGKILL every live shell of this run, abort its pending
  // approvals, and cancel its waiting shell approval requests so stuck tools
  // resolve as SHELL_KILLED instead of hanging until timeout.
  ctx.shellService.killRunsForRun(params.runId);
  try {
    await ctx.shellService.cancelPendingForRun(params.runId);
  } catch (err) {
    ctx.logger.warn({ err, runId: params.runId }, 'cancel run: shell pending abort failed');
  }
  try {
    await cancelShellApprovalRequests(ctx, params.chatId);
  } catch (err) {
    ctx.logger.warn({ err, runId: params.runId }, 'cancel run: HITL approval cancel failed');
  }
  const finished = await ctx.runService.finish(params.runId, 'cancelled', {
    code: 'RUN_ABORTED',
    message: 'Run cancelled by user',
  });
  return finished ?? run;
}

async function cancelShellApprovalRequests(ctx: Container, chatId: string): Promise<void> {
  const pending = await ctx.hitlService.listPending();
  for (const request of pending) {
    if (request.chatId !== chatId) continue;
    if (request.metadata?.source !== 'shell') continue;
    try {
      await ctx.hitlService.cancel(request.id);
    } catch {
      // best-effort: already resolved requests cannot be cancelled
    }
  }
}
