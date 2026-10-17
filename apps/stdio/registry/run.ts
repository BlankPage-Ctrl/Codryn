import { z } from 'zod';
import {
  startMessageRun,
  watchMessageRun,
  watchMessageSubrun,
  killMessageSubrun,
  getMessageRun,
  listMessageRuns,
  cancelMessageRun,
} from '../../actions/index.js';
import { SendMessageSchema } from '../../validators/message.js';
import { RunParamsSchema, RunIdParamsSchema, SubRunIdParamsSchema } from '../../validators/run.js';
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

const WatchSubRunSchema = WatchRunSchema.extend({ toolCallId: IdSchema });

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
  'watch.message-subrun': {
    kind: 'run-stream',
    validate: (p) => WatchSubRunSchema.parse(p),
    run: act(watchMessageSubrun),
  },
  'kill.message-subrun': {
    kind: 'plain',
    validate: (p) => SubRunIdParamsSchema.parse(p),
    run: act(killMessageSubrun),
  },
};
