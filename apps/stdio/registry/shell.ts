// import { decideApproval, listPendingApprovals } from '../../actions/index.js';
// import { validateDecideApprovalParams } from '../../validators/shell.js';
// import { act, noParams } from './types.js';
import { type StdioMethod } from './types.js';

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
};
