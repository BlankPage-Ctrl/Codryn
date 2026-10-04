import type { TextStreamPart, ToolSet } from 'ai';
import {
  normalizeStepFinish,
  type MessagesService,
  type IStreamingPersister,
} from '../../src/messages/index.js';
import { mapFeedChunk } from './chat-feed/index.js';
import type { FeedBridge } from './chat-feed/bridge.js';
import type { Logger } from './types.js';

export interface RawStepFinish {
  finishReason: string;
  toolCalls?: unknown[];
  usage?: unknown;
  response?: unknown;
  providerMetadata?: unknown;
}

export interface StepRecorderDeps {
  store: Pick<MessagesService, 'recordRunStep'>;
  persister: Pick<IStreamingPersister, 'onChunk'>;
  bridge: FeedBridge;
  logger: Logger;
  runId: string;
  chatId: string;
  assistantMessageId: string;
}

export interface StepStats {
  stepCount: number;
  lastFinishReason: string | undefined;
}

/**
 * Owns per-step run state (`stepCount`, `lastFinishReason`, stage timing).
 * `onChunk` mirrors stream chunks to the feed + persister; `onStepFinish`
 * normalizes usage, records the run step, and closes the feed stage.
 */
export function createStepRecorder(deps: StepRecorderDeps): {
  onChunk: (args: { chunk: TextStreamPart<ToolSet> }) => Promise<void>;
  onStepFinish: (event: RawStepFinish) => Promise<void>;
  getStats: () => StepStats;
} {
  const { store, persister, bridge, logger, runId, chatId, assistantMessageId } = deps;
  let stepCount = 0;
  let lastFinishReason: string | undefined;
  let stepStartedAtMs = Date.now();
  let feedStage = 0;

  const onChunk = ({ chunk }: { chunk: TextStreamPart<ToolSet> }): Promise<void> => {
    try {
      const drafts = mapFeedChunk(chunk, {
        ...bridge.scope,
        stage: feedStage,
      });
      for (const draft of drafts) {
        if (draft.name === 'stage-open') feedStage += 1;
        // SAFE: drafts are correlated name+payload pairs built by
        // mapFeedChunk; the bus expects the matching payload type.
        bridge.emitSafe(draft.name, draft.payload as never);
      }
    } catch (err) {
      logger.error({ err, runId }, 'feed map failed');
    }
    return persister.onChunk(chunk);
  };

  const onStepFinish = async (event: RawStepFinish): Promise<void> => {
    const stepIndex = stepCount;
    stepCount += 1;
    lastFinishReason = event.finishReason;
    const finishedAtMs = Date.now();
    let landed = event.finishReason;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let totalTokens: number | undefined;
    try {
      const normalized = normalizeStepFinish(event);
      landed = normalized.finishReason ?? event.finishReason;
      inputTokens = normalized.inputTokens ?? undefined;
      outputTokens = normalized.outputTokens ?? undefined;
      totalTokens = normalized.totalTokens ?? undefined;
      await store.recordRunStep({
        messageId: assistantMessageId,
        chatId,
        runId,
        stepIndex,
        finishReason: normalized.finishReason,
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        totalTokens: normalized.totalTokens,
        modelId: normalized.modelId,
        providerMetadataJson: normalized.providerMetadataJson,
        toolCallsJson: normalized.toolCallsJson,
        startedAtMs: stepStartedAtMs,
        finishedAtMs,
      });
    } catch (err) {
      logger.error({ sensitive: true, err, runId, stepIndex }, 'run step persistence error');
    } finally {
      stepStartedAtMs = Date.now();
    }
    bridge.emitSafe('stage-close', {
      ...bridge.scope,
      stage: stepIndex,
      landed,
      at: Date.now(),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
    });
  };

  return {
    onChunk,
    onStepFinish,
    getStats: () => ({ stepCount, lastFinishReason }),
  };
}
