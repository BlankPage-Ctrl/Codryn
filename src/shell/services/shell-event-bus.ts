import { EventEmitter } from 'node:events';
import type {
  IShellExecEventBus,
  ShellExecEventMap,
  ShellExecEventName,
  ShellExecEventHandler,
} from '../types/shell-events.js';

export class ShellExecEventBus implements IShellExecEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends ShellExecEventName>(name: K, handler: ShellExecEventHandler<K>): void {
    this.emitter.on(name, handler as (payload: unknown) => void);
  }

  off<K extends ShellExecEventName>(name: K, handler: ShellExecEventHandler<K>): void {
    this.emitter.off(name, handler as (payload: unknown) => void);
  }

  emit<K extends ShellExecEventName>(name: K, payload: ShellExecEventMap[K]): void {
    this.emitter.emit(name, payload);
  }
}
