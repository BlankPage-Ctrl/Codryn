import { PassThrough } from 'node:stream';
import type { Container } from '../bootstrap.js';
import { NotFoundError } from '../shared/errors.js';
import { framesAfter, toSubRunKey } from '../../src/runs/index.js';
import type { SubLiveStatus } from '../../src/runs/index.js';
import type { FeedRunCloseStatus } from '../shared/chat-feed/index.js';

export interface WatchMessageSubrunParams {
  workspaceId: string;
  chatId: string;
  runId: string;
  toolCallId: string;
  afterSeq?: number;
}

export interface WatchMessageSubrunResult {
  stream: PassThrough;
  run: { runId: string; status: SubLiveStatus };
}

/**
 * Attaches to a child (sub-agent) run and streams its feed events.
 * Replays buffered events after `afterSeq`, then follows live chunks.
 * Closing this stream only unsubscribes - the child keeps running.
 * Terminal frame is a `run-close` feed event scoped to the sub-run key.
 */
export async function watchMessageSubrun(
  ctx: Container,
  params: WatchMessageSubrunParams,
): Promise<WatchMessageSubrunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  const run = await ctx.runService.get(params.runId);
  if (!run || run.chatId !== params.chatId)
    throw new NotFoundError(`Run ${params.runId} not found`);

  const subKey = toSubRunKey(params.runId, params.toolCallId);
  const meta = ctx.runService.getSubMeta(subKey);
  if (!meta) throw new NotFoundError(`Sub-run ${subKey} not found`);

  const stream = new PassThrough();
  const afterSeq = params.afterSeq ?? 0;

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

  const replay = framesAfter(ctx.runService.framesSub(subKey), afterSeq);
  for (const frame of replay) {
    safeWrite(frame.line);
  }

  const closeLine = (
    status: FeedRunCloseStatus,
    extra?: { code?: string; message?: string },
  ): string => {
    return `data: ${JSON.stringify({
      type: 'run-close',
      runId: subKey,
      chatId: params.chatId,
      assistantMessageId: meta.assistantMessageId,
      parentRunId: params.runId,
      toolCallId: params.toolCallId,
      status,
      at: Date.now(),
      ...(extra ?? {}),
    })}\n\n`;
  };

  const current = ctx.runService.getSubStatus(subKey);
  if (current !== 'running') {
    const terminal: SubLiveStatus =
      current === 'cancelled' ? 'cancelled' : current === 'done' ? 'done' : 'failed';
    safeWrite(closeLine(terminal));
    endOnce();
    return { stream, run: { runId: subKey, status: terminal } };
  }

  const unsubscribe = ctx.runService.subscribeSub(subKey, {
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

  return { stream, run: { runId: subKey, status: 'running' } };
}
