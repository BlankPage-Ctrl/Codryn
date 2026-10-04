import { CHAT_FEED_NAMES, ChatFeedBus, encodeFeedLine } from './index.js';
import type { ChatFeedEventMap, ChatFeedEventName } from './feed-events.js';
import type { Logger } from '../types.js';

export interface FeedBridgeScope {
  runId: string;
  chatId: string;
  messageId: string;
}

export interface FeedBridge {
  feed: ChatFeedBus;
  scope: FeedBridgeScope;
  emitSafe<K extends ChatFeedEventName>(name: K, payload: ChatFeedEventMap[K]): void;
}

export interface FeedBridgeDeps {
  publishChunk: (line: string) => void;
  logger: Logger;
  runId: string;
  chatId: string;
  assistantMessageId: string;
}

/**
 * Wires a `ChatFeedBus` to the run's SSE channel: every feed event is encoded
 * and published via `publishChunk`. Emits `run-open` immediately.
 * `emitSafe` never throws - failures are logged with the run context.
 */
export function createFeedBridge(deps: FeedBridgeDeps): FeedBridge {
  const { publishChunk, logger, runId, chatId, assistantMessageId } = deps;
  const feed = new ChatFeedBus();
  for (const name of CHAT_FEED_NAMES) {
    // SAFE: bridge forwards the correlated name+payload pair; every emit
    // site passes the matching payload type for its name, and `never`
    // satisfies the generic correlation at this single funnel point.
    const forward = (payload: unknown): void => {
      try {
        publishChunk(encodeFeedLine(name, payload as never));
      } catch (err) {
        logger.error({ err, runId, name }, 'feed publish failed');
      }
    };
    feed.on(name, forward as never);
  }
  const scope: FeedBridgeScope = { runId, chatId, messageId: assistantMessageId };
  const bridge: FeedBridge = {
    feed,
    scope,
    emitSafe(name, payload) {
      try {
        feed.emit(name, payload);
      } catch (err) {
        logger.error({ err, runId, name }, 'feed emit failed');
      }
    },
  };
  bridge.emitSafe('run-open', {
    runId,
    chatId,
    assistantMessageId,
    at: Date.now(),
  });
  return bridge;
}
