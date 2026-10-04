import { EventEmitter } from 'node:events';
import type { HitlEventMap, HitlEventName, HitlEventHandler } from '../types/events.js';

export class HitlEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends HitlEventName>(name: K, handler: HitlEventHandler<K>): void {
    this.emitter.on(name, handler as (payload: unknown) => void);
  }

  off<K extends HitlEventName>(name: K, handler: HitlEventHandler<K>): void {
    this.emitter.off(name, handler as (payload: unknown) => void);
  }

  emit<K extends HitlEventName>(name: K, payload: HitlEventMap[K]): void {
    this.emitter.emit(name, payload);
  }
}
