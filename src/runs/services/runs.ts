import { EventEmitter } from 'node:events';
import type {
  IRunManager,
  IRunRepository,
  RunErrorInfo,
  RunRecord,
  RunStatus,
  SseFrame,
} from '../types/index.js';

interface LiveRun {
  controller: AbortController;
  emitter: EventEmitter;
  nextSeq: number;
  buffer: SseFrame[];
  /** Set once a terminal event (done/error) was published, late chunks are dropped, never emitted. */
  terminal: boolean;
}

const MAX_BUFFERED_FRAMES = 2000;

function createRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export class RunsService implements IRunManager {
  private readonly live = new Map<string, LiveRun>();

  constructor(private readonly repo: IRunRepository) {}

  private ensureLive(runId: string): LiveRun {
    let entry = this.live.get(runId);
    if (!entry) {
      entry = {
        controller: new AbortController(),
        emitter: new EventEmitter(),
        nextSeq: 0,
        buffer: [],
        terminal: false,
      };
      entry.emitter.setMaxListeners(50);
      this.live.set(runId, entry);
    }
    return entry;
  }

  async create(input: {
    chatId: string;
    workspaceId: string;
    assistantMessageId: string;
  }): Promise<RunRecord> {
    const now = Date.now();
    const record: RunRecord = {
      runId: createRunId(),
      chatId: input.chatId,
      workspaceId: input.workspaceId,
      assistantMessageId: input.assistantMessageId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      pendingApproval: null,
    };
    const saved = await this.repo.save(record);
    this.ensureLive(saved.runId);
    return saved;
  }

  async get(runId: string): Promise<RunRecord | null> {
    return this.repo.get(runId);
  }

  async listByChat(chatId: string): Promise<RunRecord[]> {
    return this.repo.listByChat(chatId);
  }

  async finish(
    runId: string,
    status: Extract<RunStatus, 'done' | 'failed' | 'cancelled'>,
    error?: RunRecord['error'],
  ): Promise<RunRecord | null> {
    const current = await this.repo.get(runId);
    if (!current) return null;
    if (current.status !== 'running') return current;
    const updated: RunRecord = {
      ...current,
      status,
      updatedAt: Date.now(),
      ...(error !== undefined ? { error } : {}),
    };
    const saved = await this.repo.save(updated);
    if (status === 'done') this.publishDone(runId);
    if (status === 'failed' || status === 'cancelled') {
      this.publishError(runId, {
        status,
        code: error?.code ?? (status === 'cancelled' ? 'RUN_ABORTED' : 'INTERNAL_ERROR'),
        message: error?.message ?? status,
      });
    }
    return saved;
  }

  abortSignal(runId: string): AbortSignal | null {
    return this.live.get(runId)?.controller.signal ?? null;
  }

  requestCancel(runId: string): boolean {
    const entry = this.live.get(runId);
    if (!entry) return false;
    if (entry.controller.signal.aborted) return true;
    entry.controller.abort();
    return true;
  }

  /**
   * Buffer + broadcast one SSE event. Returns false (without emitting) when
   * the run already reached a terminal state, e.g. a drain-loop tail racing
   * publishDone. Late watchers still get everything via frames()/replay.
   */
  publishChunk(runId: string, line: string): boolean {
    const entry = this.ensureLive(runId);
    if (entry.terminal) return false;
    entry.nextSeq += 1;
    const framed = this.withSeq(line, entry.nextSeq);
    entry.buffer.push({ seq: entry.nextSeq, line: framed });
    if (entry.buffer.length > MAX_BUFFERED_FRAMES) {
      entry.buffer.splice(0, entry.buffer.length - MAX_BUFFERED_FRAMES);
    }
    entry.emitter.emit('chunk', framed);
    return true;
  }

  publishDone(runId: string): void {
    const entry = this.live.get(runId);
    if (!entry || entry.terminal) return;
    entry.terminal = true;
    entry.emitter.emit('done');
  }

  publishError(runId: string, err: RunErrorInfo): void {
    const entry = this.live.get(runId);
    if (!entry || entry.terminal) return;
    entry.terminal = true;
    // 'error' without listeners throws in Node, guard it.
    if (entry.emitter.listenerCount('error') > 0) {
      entry.emitter.emit('error', err);
    }
  }

  subscribe(
    runId: string,
    listener: {
      onChunk: (line: string) => void;
      onDone: () => void;
      onError: (err: RunErrorInfo) => void;
    },
  ): () => void {
    const entry = this.ensureLive(runId);
    entry.emitter.on('chunk', listener.onChunk);
    entry.emitter.on('done', listener.onDone);
    entry.emitter.on('error', listener.onError);
    return () => {
      entry.emitter.off('chunk', listener.onChunk);
      entry.emitter.off('done', listener.onDone);
      entry.emitter.off('error', listener.onError);
    };
  }

  frames(runId: string): SseFrame[] {
    return [...(this.live.get(runId)?.buffer ?? [])];
  }

  private withSeq(line: string, seq: number): string {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data: ')) return `data: ${JSON.stringify({ seq })}\n\n`;
    const payload = trimmed.slice('data: '.length).trim();
    if (!payload) return `data: ${JSON.stringify({ seq })}\n\n`;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return `data: ${JSON.stringify({ ...parsed, seq })}\n\n`;
      }
    } catch {
      // not JSON, wrap as text frame
    }
    return `data: ${JSON.stringify({ seq, text: payload })}\n\n`;
  }
}
