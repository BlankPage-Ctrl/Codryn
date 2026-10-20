import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import { toSubRunKey } from '../../src/runs/index.js';
import { cancelSubAgentHitl } from '../agent/subagents/hitl-scope.js';

export interface KillMessageSubrunParams {
  workspaceId: string;
  chatId: string;
  runId: string;
  toolCallId: string;
}

export interface KillMessageSubrunResult {
  subKey: string;
  killed: boolean;
}

/**
 * Aborts one child run. The parent run is untouched; the child's live shell
 * executions (scoped to the sub-run key) are SIGKILLed best-effort. The child
 * reports a terminal `cancelled` frame once its loop unwinds.
 */
export async function killMessageSubrun(
  ctx: Container,
  params: KillMessageSubrunParams,
): Promise<KillMessageSubrunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  const run = await ctx.runService.get(params.runId);
  if (!run || run.chatId !== params.chatId)
    throw new NotFoundError(`Run ${params.runId} not found`);

  const subKey = toSubRunKey(params.runId, params.toolCallId);
  if (!ctx.runService.getSubMeta(subKey)) throw new NotFoundError(`Sub-run ${subKey} not found`);

  const killed = ctx.runService.killSub(subKey);
  try {
    ctx.shellService.killRunsForRun(subKey);
  } catch (err) {
    ctx.logger.warn({ err, subKey }, 'kill sub-run: shell kill failed');
  }
  try {
    const cleanup = await cancelSubAgentHitl(
      ctx.hitlService,
      (owner) => owner.toolCallId === params.toolCallId && owner.parentRunId === params.runId,
    );
    if (cleanup.failures) {
      ctx.logger.warn({ failures: cleanup.failures, subKey }, 'kill sub-run: HITL cancel failed');
    }
  } catch (err) {
    ctx.logger.warn({ err, subKey }, 'kill sub-run: HITL cancel failed');
  }
  return { subKey, killed };
}
