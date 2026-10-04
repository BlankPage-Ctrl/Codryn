export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface RunRecord {
  runId: string;
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  error?: { code: string; message: string; details?: unknown };
  pendingApproval?: unknown | null;
}

export interface CreateRunInput {
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
}

export interface RunErrorInfo {
  status: Extract<RunStatus, 'failed' | 'cancelled'>;
  code: string;
  message: string;
}

export interface RunChunkListener {
  onChunk: (frame: string) => void;
  onDone: () => void;
  onError: (err: RunErrorInfo) => void;
}
