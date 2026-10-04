import type { Verdict } from '../../src/shell/index.js';

export interface ShellServerConfig {
  enabled: boolean;
  shell: string;
  defaultTimeoutMs: number;
  maxOutputChars: number;
  defaultMode: Verdict;
  hardDeny: string[];
  approvalEnabled: boolean;
  approvalTtlMs: number;
}

export interface McpServerConfig {
  enabled: boolean;
  toolsEnabled: boolean;
  resourcesEnabled: boolean;
  promptsEnabled: boolean;
  elicitationEnabled: boolean;
  defaultTimeoutMs: number;
  maxServers: number;
  maxToolsPerServer: number;
}

export interface LoggingServerConfig {
  level: string;
  dir?: string;
  maxSizeMb: number;
  maxFiles: number;
  consoleEnabled: boolean;
}

export interface TelemetryServerConfig {
  enabled: boolean;
  endpoint: string;
}

export interface ServerConfig {
  server: { port: number; host: string };
  database: { path: string };
  auth: { defaultClientSecretKey: string };
  shell: ShellServerConfig;
  mcp: McpServerConfig;
  logging: LoggingServerConfig;
  telemetry: TelemetryServerConfig;
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
