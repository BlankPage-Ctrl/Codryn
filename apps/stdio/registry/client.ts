import {
  createClient,
  listClients,
  rotateClientSecret,
  deleteClient,
} from '../../actions/index.js';
import { ClientCreateSchema } from '../../../src/auth/index.js';
import { act, idParam, noParams, type StdioMethod } from './types.js';

export const clientMethods: Record<string, StdioMethod> = {
  'create.client': {
    kind: 'plain',
    validate: (p) => ClientCreateSchema.parse(p),
    run: act(createClient),
  },
  'list.client': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => listClients(ctx),
  },
  'rotate.client': {
    kind: 'plain',
    validate: (p) => idParam.parse(p),
    run: act(rotateClientSecret),
  },
  'delete.client': {
    kind: 'plain',
    validate: (p) => idParam.parse(p),
    run: act(deleteClient),
  },
};
