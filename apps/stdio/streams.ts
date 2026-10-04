// StreamRegistry tracks the AbortControllers backing active STDIO streams,
// keyed by the JSON-RPC request id that owns them. A `cancel` notification
// aborts one stream; process shutdown aborts them all.
export class StreamRegistry {
  private controllers = new Map<string, AbortController>();

  register(id: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    return controller.signal;
  }

  abort(id: string): void {
    this.controllers.get(id)?.abort();
  }

  unregister(id: string): void {
    this.controllers.delete(id);
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
