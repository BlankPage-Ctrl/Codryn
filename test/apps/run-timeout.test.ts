import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunEndHandler, handleBackgroundRunFailure } from '../../apps/shared/run-driver.js';
import { mapAiError } from '../../apps/shared/ai-errors/index.js';
import type { FeedBridge } from '../../apps/shared/chat-feed/bridge.js';
import type { IStreamingPersister } from '../../src/messages/index.js';
import type { RunsService } from '../../src/runs/index.js';
import type { RunStatus } from '../../src/runs/types/run.js';

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

interface FinishedRun {
  status: string;
  error?: { code: string; message: string };
}

function fakeRuns(finished: FinishedRun[]): Pick<RunsService, 'finish'> {
  return {
    finish: async (
      _runId: string,
      status: Extract<RunStatus, 'done' | 'failed' | 'cancelled'>,
      error?: { code: string; message: string },
    ) => {
      finished.push({ status, ...(error ? { error } : {}) });
      return null;
    },
    // SAFE: test double for the class method under test.
  } as unknown as Pick<RunsService, 'finish'>;
}

function fakeBridge(): FeedBridge {
  return {
    feed: {} as FeedBridge['feed'],
    scope: { runId: 'run_1', chatId: 'chat-1', messageId: 'msg-1' },
    emitSafe: () => {},
    // SAFE: test double for the bridge the handlers only publish through.
  } as unknown as FeedBridge;
}

test('mapAiError reports a TimeoutError as RUN_TIMEOUT', () => {
  const err = new Error('The operation timed out');
  err.name = 'TimeoutError';
  const mapped = mapAiError(err);
  assert.equal(mapped.code, 'RUN_TIMEOUT');
  assert.equal(mapped.status, 504);
});

test('run end marks a budget overrun as failed instead of cancelled', async () => {
  const finished: FinishedRun[] = [];
  const handler = createRunEndHandler({
    persister: { finalize: async () => {} } as unknown as Pick<IStreamingPersister, 'finalize'>,
    runs: fakeRuns(finished),
    logger: NOOP_LOGGER,
    runId: 'run_1',
    markFinalized: () => {},
    getStats: () => ({ stepCount: 3, lastFinishReason: 'tool-calls' }),
    isTimedOut: () => true,
  });

  await handler({ messages: [], isAborted: true });

  assert.equal(finished.length, 1);
  assert.equal(finished[0]!.status, 'failed');
  assert.equal(finished[0]!.error?.code, 'RUN_TIMEOUT');
});

test('run end keeps a user cancellation as cancelled', async () => {
  const finished: FinishedRun[] = [];
  const handler = createRunEndHandler({
    persister: { finalize: async () => {} } as unknown as Pick<IStreamingPersister, 'finalize'>,
    runs: fakeRuns(finished),
    logger: NOOP_LOGGER,
    runId: 'run_1',
    markFinalized: () => {},
    getStats: () => ({ stepCount: 3, lastFinishReason: 'tool-calls' }),
    isTimedOut: () => false,
  });

  await handler({ messages: [], isAborted: true });

  assert.equal(finished[0]!.status, 'cancelled');
  assert.equal(finished[0]!.error?.code, 'RUN_ABORTED');
});

test('background failure reports a budget overrun as failed', async () => {
  const finished: FinishedRun[] = [];
  await handleBackgroundRunFailure(
    {
      runs: fakeRuns(finished),
      persister: {
        interrupt: async () => {},
        discard: async () => {},
      } as unknown as Pick<IStreamingPersister, 'interrupt' | 'discard'>,
      bridge: fakeBridge(),
      logger: NOOP_LOGGER,
      chatId: 'chat-1',
      runId: 'run_1',
      isTimedOut: () => true,
    },
    new Error('aborted'),
    { aborted: true, finalized: false },
  );

  assert.equal(finished[0]!.status, 'failed');
  assert.equal(finished[0]!.error?.code, 'RUN_TIMEOUT');
});
