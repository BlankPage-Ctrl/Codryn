import type { ShellRunData } from './result.js';
import type { ShellErrorCode } from './error-codes.js';

export interface ShellExecChunk {
  stream: 'stdout' | 'stderr';
  text: string;
  at: number;
}

export interface ShellExecStartPayload {
  executionId: string;
  toolCallId: string | null;
  workspaceId: string | null;
  command: string;
  cwd: string;
}

export interface ShellExecChunkPayload extends ShellExecChunk {
  executionId: string;
  toolCallId: string | null;
  workspaceId: string | null;
}

export interface ShellExecDonePayload {
  executionId: string;
  toolCallId: string | null;
  workspaceId: string | null;
  data: ShellRunData;
}

export interface ShellExecErrorPayload {
  executionId: string;
  toolCallId: string | null;
  workspaceId: string | null;
  code: ShellErrorCode;
  message: string;
  details?: unknown;
}

export interface ShellExecEventMap {
  start: ShellExecStartPayload;
  chunk: ShellExecChunkPayload;
  done: ShellExecDonePayload;
  error: ShellExecErrorPayload;
}

export type ShellExecEventName = keyof ShellExecEventMap;

export type ShellExecEventHandler<K extends ShellExecEventName> = (
  payload: ShellExecEventMap[K],
) => void;

export interface IShellExecEventBus {
  on<K extends ShellExecEventName>(name: K, handler: ShellExecEventHandler<K>): void;
  off<K extends ShellExecEventName>(name: K, handler: ShellExecEventHandler<K>): void;
  emit<K extends ShellExecEventName>(name: K, payload: ShellExecEventMap[K]): void;
}
