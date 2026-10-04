import type { RunRecord, RunStatus, RunErrorInfo } from './run.js';

export interface IRunStorage {
  get(runId: string): Promise<RunRecord | null>;
  set(record: RunRecord): Promise<void>;
  delete(runId: string): Promise<void>;
  listByChat(chatId: string): Promise<RunRecord[]>;
}

export interface IRunRepository {
  get(runId: string): Promise<RunRecord | null>;
  save(record: RunRecord): Promise<RunRecord>;
  remove(runId: string): Promise<void>;
  listByChat(chatId: string): Promise<RunRecord[]>;
}

export interface SseFrame {
  seq: number;
  line: string;
}

export interface IRunManager {
  create(input: {
    chatId: string;
    workspaceId: string;
    assistantMessageId: string;
  }): Promise<RunRecord>;
  get(runId: string): Promise<RunRecord | null>;
  listByChat(chatId: string): Promise<RunRecord[]>;
  finish(
    runId: string,
    status: Extract<RunStatus, 'done' | 'failed' | 'cancelled'>,
    error?: RunRecord['error'],
  ): Promise<RunRecord | null>;
  abortSignal(runId: string): AbortSignal | null;
  requestCancel(runId: string): boolean;
  publishChunk(runId: string, line: string): void;
  publishDone(runId: string): void;
  publishError(runId: string, err: RunErrorInfo): void;
  subscribe(
    runId: string,
    listener: {
      onChunk: (line: string) => void;
      onDone: () => void;
      onError: (err: RunErrorInfo) => void;
    },
  ): () => void;
  frames(runId: string): SseFrame[];
}
