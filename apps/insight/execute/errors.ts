export class InsightDisabledError extends Error {
  public readonly code = 'INSIGHT_DISABLED';
  public readonly statusCode = 503;
  constructor(workspaceId: string) {
    super(`Insight disabled for workspace ${workspaceId}`);
    this.name = 'InsightDisabledError';
  }
}

export class InsightBinaryError extends Error {
  public readonly code = 'INSIGHT_BINARY_ERROR';
  public readonly statusCode = 500;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'InsightBinaryError';
    if (cause !== undefined) (this as unknown as Record<string, unknown>).cause = cause;
  }
}

export class InsightEntryNotFoundError extends Error {
  public readonly code = 'INSIGHT_ENTRY_NOT_FOUND';
  public readonly statusCode = 404;
  constructor(id: string) {
    super(`entry ID not found: ${id}`);
    this.name = 'InsightEntryNotFoundError';
  }
}

export class InsightSyncThrottledError extends Error {
  public readonly code = 'INSIGHT_SYNC_THROTTLED';
  public readonly statusCode = 429;
  public readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'InsightSyncThrottledError';
    this.retryAfterMs = retryAfterMs;
    (this as unknown as Record<string, unknown>).retryAfterMs = retryAfterMs;
  }
}

export class InsightTerminalError extends Error {
  public readonly code = 'INSIGHT_TERMINAL';
  public readonly statusCode = 500;
  public readonly terminalCode: number;
  constructor(message: string, terminalCode = -32000) {
    super(message);
    this.name = 'InsightTerminalError';
    this.terminalCode = terminalCode;
  }
}

export class InsightBusyError extends Error {
  public readonly code = 'INSIGHT_BUSY';
  public readonly statusCode = 429;
  public readonly retryAfterMs?: number;
  constructor(message = 'insight busy: a write is already running — retry or check status first') {
    super(message);
    this.name = 'InsightBusyError';
  }
}

export class InsightIncompatibleError extends InsightBinaryError {
  constructor(binaryPath: string, actual: string, expected: string) {
    super(`insight binary v${actual} at ${binaryPath} is incompatible (expected ${expected})`);
    this.name = 'InsightIncompatibleError';
    (this as unknown as Record<string, unknown>).code = 'INSIGHT_INCOMPATIBLE';
    (this as unknown as Record<string, unknown>).binaryPath = binaryPath;
    (this as unknown as Record<string, unknown>).actualVersion = actual;
    (this as unknown as Record<string, unknown>).expectedRange = expected;
  }
}
