import { EventEmitter } from 'node:events';
import type {
  ChatFeedEventMap,
  ChatFeedEventName,
  ChatFeedEventHandler,
  IChatFeedBus,
} from './feed-events.js';

export class ChatFeedBus implements IChatFeedBus {
  private readonly emitter = new EventEmitter();

  on<K extends ChatFeedEventName>(name: K, handler: ChatFeedEventHandler<K>): void {
    this.emitter.on(name, handler as (payload: unknown) => void);
  }

  off<K extends ChatFeedEventName>(name: K, handler: ChatFeedEventHandler<K>): void {
    this.emitter.off(name, handler as (payload: unknown) => void);
  }

  emit<K extends ChatFeedEventName>(name: K, payload: ChatFeedEventMap[K]): void {
    this.emitter.emit(name, payload);
  }
}
