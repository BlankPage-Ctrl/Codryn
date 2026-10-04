import type { ChatFeedEventMap, ChatFeedEventName } from './feed-events.js';
import { FeedEncodeError } from './errors/index.js';

export function encodeFeedLine<K extends ChatFeedEventName>(
  name: K,
  payload: ChatFeedEventMap[K],
): string {
  try {
    return `data: ${JSON.stringify({ type: name, ...payload })}\n\n`;
  } catch (err) {
    throw new FeedEncodeError('chat-feed: failed to encode SSE line', { name, err });
  }
}
