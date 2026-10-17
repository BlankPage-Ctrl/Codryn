import type { RunErrorInfo } from './run.js';
import type { SseFrame } from './manager.js';

export interface SubLiveMeta {
  parentRunId: string;
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
  toolCallId: string;
  agentName: string;
}

export interface SubChunkListener {
  onChunk: (line: string) => void;
  onDone: () => void;
  onError: (err: RunErrorInfo) => void;
}

export type SubLiveStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface ISubAgentLive {
  ensureSub(meta: SubLiveMeta): string;
  getSubMeta(subKey: string): SubLiveMeta | null;
  getSubStatus(subKey: string): SubLiveStatus | null;
  isSubOpen(subKey: string): boolean;
  publishSubChunk(subKey: string, line: string): boolean;
  publishSubDone(subKey: string): void;
  publishSubError(subKey: string, err: RunErrorInfo): void;
  subscribeSub(subKey: string, listener: SubChunkListener): () => void;
  framesSub(subKey: string): SseFrame[];
  killSub(subKey: string): boolean;
  killSubsForRun(parentRunId: string): { killedCount: number };
}
