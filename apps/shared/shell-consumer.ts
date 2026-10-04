import type { Container } from '../bootstrap.js';
import { ShellConsumer } from '../../src/shell/index.js';
import { loadWorkspacePolicy } from './workspace-policy.js';

export function buildShellConsumer(
  ctx: Container,
  workspaceRoot: string,
  workspaceId?: string,
): ShellConsumer {
  return new ShellConsumer(ctx.shellService, workspaceRoot, loadWorkspacePolicy, workspaceId);
}
