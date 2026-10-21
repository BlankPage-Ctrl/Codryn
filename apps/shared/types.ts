import type { Verdict } from '../../src/shell/index.js';

export interface ShellServerConfig {
  enabled: boolean;
  shell: string;
  defaultTimeoutMs: number;
  maxOutputChars: number;
  defaultMode: Verdict;
  readonly: string[];
  secureDeny: string[];
  hardDeny: string[];
  approvalEnabled: boolean;
  approvalTtlMs: number;
}

export interface FileServerConfig {
  sensitivePatterns: string[];
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

export type PluginHookConflictPolicy = 'reject' | 'priority' | 'ask-user';

export interface PluginHookServerConfig {
  enabled: boolean;
  /** Per plugin reply timeout for a hook that expects an answer. */
  timeoutMs: number;
  /** Cap on plugins that may write one hook per round. */
  maxWriters: number;
  /** How a path two plugins changed is settled. */
  conflictPolicy: PluginHookConflictPolicy;
}

export interface PluginServerConfig {
  enabled: boolean;
  maxPlugins: number;
  maxSkillsPerPlugin: number;
  maxToolsPerPlugin: number;
  hooks: PluginHookServerConfig;
}

export interface ServerConfig {
  server: { port: number; host: string };
  database: { path: string };
  auth: { defaultClientSecretKey: string };
  shell: ShellServerConfig;
  files: FileServerConfig;
  mcp: McpServerConfig;
  plugins: PluginServerConfig;
  logging: LoggingServerConfig;
  telemetry: TelemetryServerConfig;
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
