import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import type { RunRecord } from '../../src/runs/index.js';
import { subAgentScopeFromMetadata } from '../agent/subagents/hitl-scope.js';

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
  try {
    ctx.runService.killSubsForRun(params.runId);
  } catch (err) {
    ctx.logger.warn({ err, runId: params.runId }, 'cancel run: sub-agent kill failed');
  }
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
    await cancelRunHitlRequests(ctx, params.chatId, params.runId);
  } catch (err) {
    ctx.logger.warn({ err, runId: params.runId }, 'cancel run: HITL approval cancel failed');
  }
  const finished = await ctx.runService.finish(params.runId, 'cancelled', {
    code: 'RUN_ABORTED',
    message: 'Run cancelled by user',
  });
  return finished ?? run;
}

async function cancelRunHitlRequests(ctx: Container, chatId: string, runId: string): Promise<void> {
  const pending = await ctx.hitlService.listPending();
  for (const request of pending) {
    if (request.chatId !== chatId) continue;
    const taggedRunId = request.metadata?.runId;
    const isShellApproval = request.metadata?.source === 'shell';
    const isAgentRequest = request.metadata?.source === 'agent';
    const owner = subAgentScopeFromMetadata(request.metadata);
    const isSubAgentRequest = owner?.parentRunId === runId;
    const belongsToRun =
      typeof taggedRunId === 'string' && taggedRunId.length > 0
        ? taggedRunId === runId
        : isShellApproval || isAgentRequest || isSubAgentRequest;
    if (!belongsToRun) continue;
    try {
      await ctx.hitlService.cancel(request.id);
    } catch {
      // best-effort: already resolved requests cannot be cancelled
    }
  }
}
