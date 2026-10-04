import { PassThrough } from 'node:stream';
import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import { framesAfter } from '../../src/runs/index.js';
import type { RunRecord } from '../../src/runs/index.js';
import type { FeedRunClose, FeedRunCloseStatus } from '../shared/chat-feed/index.js';

export interface WatchMessageRunParams {
  workspaceId: string;
  chatId: string;
  runId: string;
  afterSeq?: number;
}

export interface WatchMessageRunResult {
  stream: PassThrough;
  run: RunRecord;
}

/**
 * Attaches to a running (or finished) run and streams its events.
 * Replays buffered events after `afterSeq`, then follows live chunks.
 * Closing this stream only unsubscribes - the background run continues.
 * Terminal frame is a `run-close` feed event (not the legacy `run-status`).
 */
export async function watchMessageRun(
  ctx: Container,
  params: WatchMessageRunParams,
): Promise<WatchMessageRunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  const run = await ctx.runService.get(params.runId);
  if (!run || run.chatId !== params.chatId)
    throw new NotFoundError(`Run ${params.runId} not found`);

  const stream = new PassThrough();
  const afterSeq = params.afterSeq ?? 0;

  // A late publishChunk (e.g, drain-loop tail racing publishDone) must never
  // throw ERR_STREAM_WRITE_AFTER_END into the producer via emitter.emit
  let ended = false;
  const safeWrite = (line: string): void => {
    if (ended) return;
    if (stream.destroyed || stream.writableEnded || stream.closed) {
      ended = true;
      return;
    }
    try {
      stream.write(line);
    } catch {
      ended = true;
    }
  };
  const endOnce = (): void => {
    if (ended) return;
    ended = true;
    try {
      stream.end();
    } catch {
      // already ended - ignore
    }
  };

  const replay = framesAfter(ctx.runService.frames(params.runId), afterSeq);
  for (const frame of replay) {
    safeWrite(frame.line);
  }

  const closeLine = (
    status: FeedRunCloseStatus,
    extra?: Pick<FeedRunClose, 'code' | 'message'>,
  ): string => {
    const payload: FeedRunClose = {
      runId: run.runId,
      chatId: params.chatId,
      assistantMessageId: run.assistantMessageId,
      status,
      at: Date.now(),
      ...(extra !== undefined ? extra : {}),
    };
    return `data: ${JSON.stringify({ type: 'run-close', ...payload })}\n\n`;
  };

  if (run.status !== 'running') {
    const extra =
      run.error !== undefined ? { code: run.error.code, message: run.error.message } : undefined;
    safeWrite(closeLine(run.status, extra));
    endOnce();
    return { stream, run };
  }

  const unsubscribe = ctx.runService.subscribe(params.runId, {
    onChunk: (line) => {
      safeWrite(line);
    },
    onDone: () => {
      safeWrite(closeLine('done'));
      endOnce();
    },
    onError: (err) => {
      const status: FeedRunCloseStatus = err.status === 'cancelled' ? 'cancelled' : 'failed';
      safeWrite(closeLine(status, { code: err.code, message: err.message }));
      endOnce();
    },
  });

  const cleanup = () => {
    ended = true;
    unsubscribe();
  };
  stream.on('close', cleanup);
  stream.on('error', cleanup);

  return { stream, run };
}
