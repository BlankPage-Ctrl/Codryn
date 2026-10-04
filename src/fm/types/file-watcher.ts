import type { WatchEvent } from './index.js';

export interface IFileWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  setOnEvent(handler: (event: WatchEvent) => void): void;
}
