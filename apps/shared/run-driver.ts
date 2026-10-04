import type { UIMessage } from 'ai';
import type { IStreamingPersister } from '../../src/messages/index.js';
import type { RunsService } from '../../src/runs/index.js';
import { mapAiError } from './ai-errors/index.js';
import type { FeedBridge } from './chat-feed/bridge.js';
import type { Logger } from './types.js';

export interface RunEndHandlerDeps {
  persister: Pick<IStreamingPersister, 'finalize'>;
  runs: Pick<RunsService, 'finish'>;
  logger: Logger;
  runId: string;
  markFinalized: () => void;
  getStats: () => { stepCount: number; lastFinishReason: string | undefined };
}

/**
 * `onEnd` for `toUIMessageStreamResponse`: finalizes the persister, then
 * finishes the run as `done` (or `cancelled` when aborted).
 */
export function createRunEndHandler(deps: RunEndHandlerDeps) {
  return async ({
    messages,
    isAborted,
  }: {
    messages: UIMessage[];
    isAborted?: boolean;
  }): Promise<void> => {
    const { stepCount, lastFinishReason } = deps.getStats();
    deps.logger.info(
      { runId: deps.runId, isAborted, stepCount, lastFinishReason },
      'run stream onEnd — finalizing persister',
    );
    if (isAborted) {
      await deps.persister.finalize(messages);
      deps.markFinalized();
      await deps.runs.finish(deps.runId, 'cancelled', {
        code: 'RUN_ABORTED',
        message: 'Run aborted',
      });
    } else {
      await deps.persister.finalize(messages);
      deps.markFinalized();
      await deps.runs.finish(deps.runId, 'done');
    }
  };
}

export interface RunStreamErrorHandlerDeps {
  persister: Pick<IStreamingPersister, 'interrupt'>;
  bridge: FeedBridge;
  logger: Logger;
  chatId: string;
  runId: string;
  getStats: () => { stepCount: number; lastFinishReason: string | undefined };
}

/**
 * `onError` for `toUIMessageStreamResponse`: maps the error, emits `oops`
 * on the feed, interrupts the persister, and returns the user-facing message.
 */
export function createRunStreamErrorHandler(deps: RunStreamErrorHandlerDeps) {
  return (err: unknown): string => {
    const mapped = mapAiError(err, { chatId: deps.chatId });
    const { stepCount, lastFinishReason } = deps.getStats();
    deps.logger.error(
      {
        sensitive: true,
        err,
        runId: deps.runId,
        stepCount,
        lastFinishReason,
        mappedCode: mapped.code,
      },
      'run stream error',
    );
    void deps.persister.interrupt();
    deps.bridge.emitSafe('oops', {
      ...deps.bridge.scope,
      code: mapped.code,
      message: mapped.message,
      at: Date.now(),
    });
    return mapped.message;
  };
}

/**
 * Drives an internal UIMessage stream to completion (persister finalize runs
 * in `onEnd`) but discards its SSE bytes - the frontend wire is the custom
 * feed, not UIMessage chunks.
 */
export async function drainStreamBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      decoder.decode(value, { stream: true });
    }
    if (done) break;
  }
}

export interface BackgroundFailureDeps {
  runs: Pick<RunsService, 'finish'>;
  persister: Pick<IStreamingPersister, 'interrupt' | 'discard'>;
  bridge: FeedBridge;
  logger: Logger;
  chatId: string;
  runId: string;
}

/**
 * Catch-all for the detached background run. Never wipes a successfully
 * finalized message: `discard()` deletes the assistant row, so post-finalize
 * failures only need best-effort cleanup via `interrupt()`.
 * Genuine failures drop the partial message so a retry starts clean.
 */
export async function handleBackgroundRunFailure(
  deps: BackgroundFailureDeps,
  err: unknown,
  opts: { aborted: boolean; finalized: boolean },
): Promise<void> {
  deps.logger.error(
    { sensitive: true, err, runId: deps.runId, aborted: opts.aborted, finalized: opts.finalized },
    'background run failed',
  );
  if (opts.finalized) {
    await deps.persister.interrupt();
    return;
  }
  if (!opts.aborted) {
    const mapped = mapAiError(err, { chatId: deps.chatId });
    deps.bridge.emitSafe('oops', {
      ...deps.bridge.scope,
      code: mapped.code,
      message: mapped.message,
      at: Date.now(),
    });
    await deps.persister.discard();
    await deps.runs.finish(deps.runId, 'failed', {
      code: mapped.code,
      message: mapped.message,
    });
  } else {
    await deps.persister.interrupt();
    await deps.runs.finish(deps.runId, 'cancelled', {
      code: 'RUN_ABORTED',
      message: 'Run cancelled',
    });
  }
}
