import type { IFileWatcher } from '../types/file-watcher.js';
import type { WatchEvent } from '../types/index.js';

export class FileWatcherService {
  private readonly watcher: IFileWatcher;

  constructor(watcher: IFileWatcher, onEvent?: (event: WatchEvent) => void) {
    this.watcher = watcher;
    if (onEvent) {
      this.watcher.setOnEvent(onEvent);
    }
  }

  setOnEvent(handler: (event: WatchEvent) => void): void {
    this.watcher.setOnEvent(handler);
  }

  async start(): Promise<void> {
    await this.watcher.start();
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }
}
