import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../actions/index.js';
import { WorkspaceCreateSchema, WorkspaceUpdateSchema } from '../../../src/workspaces/index.js';
import { WorkspaceIdParamsSchema } from '../../validators/workspace.js';
import { act, idParam, noParams, patchParams, type StdioMethod } from './types.js';

export const workspaceMethods: Record<string, StdioMethod> = {
  'list.workspace': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => listWorkspaces(ctx),
  },
  'get.workspace': {
    kind: 'plain',
    validate: (p) => WorkspaceIdParamsSchema.parse(p),
    run: act(getWorkspace),
  },
  'create.workspace': {
    kind: 'plain',
    validate: (p) => WorkspaceCreateSchema.parse(p),
    run: act(createWorkspace),
  },
  'update.workspace': {
    kind: 'plain',
    validate: (p) => patchParams(WorkspaceUpdateSchema).parse(p),
    run: act(updateWorkspace),
  },
  'delete.workspace': {
    kind: 'plain',
    validate: (p) => idParam.parse(p),
    run: act(deleteWorkspace),
  },
};
