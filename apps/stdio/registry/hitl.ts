import { z } from 'zod';
import {
  requestHitl,
  submitHitlResponse,
  cancelHitl,
  getHitl,
  listPendingHitl,
  watchHitl,
} from '../../actions/index.js';
import { validateHitlId, validateHitlRequest } from '../../validators/hitl.js';
import { act, noParams, type StdioMethod } from './types.js';

const SubmitHitlParamsSchema = z.object({
  id: z.string().min(1),
  response: z.unknown(),
});

export const hitlMethods: Record<string, StdioMethod> = {
  'request.hitl': {
    kind: 'plain',
    validate: (p) => validateHitlRequest(p),
    run: act(requestHitl),
  },
  'get.hitl': {
    kind: 'plain',
    validate: (p) => validateHitlId(p),
    run: act(getHitl),
  },
  'list.pending.hitl': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => listPendingHitl(ctx),
  },
  'submit.hitl': {
    kind: 'plain',
    validate: (p) => SubmitHitlParamsSchema.parse(p),
    run: act(submitHitlResponse),
  },
  'cancel.hitl': {
    kind: 'plain',
    validate: (p) => validateHitlId(p),
    run: act(cancelHitl),
  },
  'watch.hitl': {
    kind: 'hitl-stream',
    validate: noParams,
    run: act(watchHitl),
  },
};
