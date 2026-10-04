import type { TelemetrySink } from './telemetry.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type TransportKind = 'http' | 'stdio' | 'cli';

export interface LoggingConfig {
  level?: string;
  dir?: string;
  maxSizeMb?: number;
  maxFiles?: number;
  consoleEnabled?: boolean;
}

export interface TelemetryConfig {
  enabled?: boolean;
  endpoint?: string;
}

export interface AppLoggerOptions {
  name?: string;
  transport?: TransportKind;
  basePath?: string;
  logging?: LoggingConfig;
  telemetry?: TelemetryConfig;
  /**
   * Explicit sink override (tests / deliberate opt-in only). Entrypoints
   * (`server.ts`, `stdio/index.ts`, `cli/logging.ts`) never pass this, so
   * production always uses the local-only Noop default.
   */
  telemetrySink?: TelemetrySink;
}

export interface Closeable {
  close(): Promise<void>;
  flush(): Promise<void>;
}

/** Marker key: record flagged sensitive is local-only, never sent to telemetry. */
export const SENSITIVE_FLAG = 'sensitive';
