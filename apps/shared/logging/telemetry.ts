/**
 * Telemetry sink interfaces - PROVIDED BUT NOT WIRED.
 *
 * Desktop/local-only policy: nothing is sent to any server unless an operator
 * explicitly constructs and passes a non-noop sink. The default everywhere is
 * {@link NoopTelemetry}. `HttpTelemetrySink` exists as a stub so a future
 * online pipeline has a shape to implement, but no call-site in
 * `apps/server.ts`, `apps/stdio/index.ts` or `apps/bootstrap.ts` may
 * instantiate it today.
 *
 * Sensitive gate: records flagged `sensitive:true` (see `sensitive.ts`) are
 * dropped BEFORE reaching any sink - never redacted-and-sent, always dropped.
 */

export interface TelemetryEvent {
  ts: string;
  level: string;
  logger: string;
  msg: string;
  fields: Record<string, unknown>;
  redactedKeys: string[];
  transport?: string;
  pid: number;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class NoopTelemetry implements TelemetrySink {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit(_event: TelemetryEvent): void {
    // intentionally nothing - local-only default
  }
  async flush(): Promise<void> {
    // nothing
  }
  async close(): Promise<void> {
    // nothing
  }
}

/**
 * Stub for a future online pipeline. NOT WIRED - do not instantiate in
 * production code paths. Kept so the batching/retry shape is reviewed once,
 * not invented later under pressure.
 */
export class HttpTelemetrySink implements TelemetrySink {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly options: {
      endpoint: string;
      apiKey?: string;
      batchSize?: number;
      flushIntervalMs?: number;
    },
  ) {
    const everyMs = options.flushIntervalMs ?? 10_000;
    this.timer = setInterval(() => {
      void this.flush().catch(() => {});
    }, everyMs);
    this.timer.unref?.();
  }

  emit(event: TelemetryEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    const batch = this.options.batchSize ?? 100;
    if (this.queue.length >= batch) {
      void this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    // NOTE: intentionally uses global fetch, no new deps. Still NOT WIRED.
    await fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({ events: batch }),
    }).catch(() => {
      // Telemetry must never break the app. Drop on failure.
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.flush().catch(() => {});
  }
}
