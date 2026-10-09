import { killShellExec } from '../../actions/index.js';
import { ShellExecutionIdParamsSchema } from '../../validators/shell.js';
import { act, type StdioMethod } from './types.js';

const KillShellExecSchema = ShellExecutionIdParamsSchema;

export const shellMethods: Record<string, StdioMethod> = {
  // 'list.pending-approvals': {
  //   kind: 'plain',
  //   validate: noParams,
  //   run: (ctx) => listPendingApprovals(ctx),
  // },
  // 'decide.approval': {
  //   kind: 'plain',
  //   validate: (p) => validateDecideApprovalParams(p),
  //   run: act(decideApproval),
  // },
  'kill.shell-exec': {
    kind: 'plain',
    validate: (p) => KillShellExecSchema.parse(p),
    run: act(killShellExec),
  },
};
