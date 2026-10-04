import { z } from 'zod';
import {
  startMessageRun,
  watchMessageRun,
  getMessageRun,
  listMessageRuns,
  cancelMessageRun,
} from '../../actions/index.js';
import { SendMessageSchema } from '../../validators/message.js';
import { RunParamsSchema, RunIdParamsSchema } from '../../validators/run.js';
import { act, IdSchema, type StdioMethod } from './types.js';

const StartRunSchema = z.object({
  workspaceId: IdSchema,
  chatId: IdSchema,
  message: SendMessageSchema.shape.message,
});

const WatchRunSchema = z.object({
  workspaceId: IdSchema,
  chatId: IdSchema,
  runId: IdSchema,
  afterSeq: z.coerce.number().int().min(0).optional().default(0),
});

export const runMethods: Record<string, StdioMethod> = {
  'start.message-run': {
    kind: 'plain',
    validate: (p) => StartRunSchema.parse(p),
    run: act(async (ctx, params: z.infer<typeof StartRunSchema>) => {
      const { run, assistantMessageId } = await startMessageRun(ctx, params);
      return { runId: run.runId, assistantMessageId, status: run.status };
    }),
  },
  'get.message-run': {
    kind: 'plain',
    validate: (p) => RunIdParamsSchema.parse(p),
    run: act(getMessageRun),
  },
  'list.message-run': {
    kind: 'plain',
    validate: (p) => RunParamsSchema.parse(p),
    run: act(listMessageRuns),
  },
  'cancel.message-run': {
    kind: 'plain',
    validate: (p) => RunIdParamsSchema.parse(p),
    run: act(cancelMessageRun),
  },
  'watch.message-run': {
    kind: 'run-stream',
    validate: (p) => WatchRunSchema.parse(p),
    run: act(watchMessageRun),
  },
};
