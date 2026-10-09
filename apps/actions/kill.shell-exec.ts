import type { Container } from '../bootstrap.js';
import type { ShellKillResult } from '../../src/shell/index.js';

export interface KillShellExecParams {
  executionId: string;
}

/**
 * Best-effort kill of one live shell run. Takes only the execution id, so
 * it works even when the workspace/chat/message that started the run was
 * deleted mid-process. Idempotent: unknown or finished ids return
 * `{ killed: false }` instead of throwing.
 */
export async function killShellExec(
  ctx: Container,
  params: KillShellExecParams,
): Promise<ShellKillResult> {
  return ctx.shellService.killRun(params.executionId);
}
