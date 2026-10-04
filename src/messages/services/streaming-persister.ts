import type { TextStreamPart, ToolSet, UIMessage } from 'ai';
import {
  applyChunkToDraft,
  BUFFER_BATCH_SIZE,
  createPartDraft,
  createsPart,
  getChunkKey,
  getChunkToolName,
  repairUnresolvedToolCalls,
  sanitizeBatchSize,
  shouldFlushImmediately,
  toolNameFromPartType,
  type ToolInputBuffer,
  UIMessageMapper,
} from '../engines/index.js';
import type { IMessagesRepository } from '../types/messages-repository.js';
import type {
  IStreamingPersister,
  StreamingPersisterOptions,
  ToolPersistPolicy,
} from '../types/streaming-persister.js';
import type { NewMessagePartRow } from '../types/message.js';
import { StorageWriteError } from '../errors/storage.js';
import { AssemblerError } from '../errors/assembler.js';

interface PendingPart extends ToolInputBuffer {
  row: NewMessagePartRow;
  inserted: boolean;
  dirty: boolean;
}

// A tool-error chunk can land on a fresh row (no prior tool-call chunk for
// this key, or input sent as undefined by the SDK) while the model input
// already sits on a sibling row under the same toolCallId. Copy it over so
// input_json stays populated on failures for later evaluation.
function backfillErrorInputFromSibling(parts: Map<string, PendingPart>, target: PendingPart): void {
  if (target.row.state !== 'output-error') return;
  if (target.row.inputJson != null) return;
  const callId = target.row.toolCallId;
  if (typeof callId !== 'string') return;
  for (const candidate of parts.values()) {
    if (candidate === target) continue;
    if (candidate.row.toolCallId !== callId) continue;
    if (candidate.row.inputJson == null) continue;
    target.row.inputJson = candidate.row.inputJson;
    return;
  }
}

export class StreamingPersister implements IStreamingPersister {
  private readonly repo: IMessagesRepository;
  private readonly chatId: string;
  private readonly messageId: string;
  private readonly userMessage: UIMessage;
  private readonly batchSize: number;
  private readonly getToolPolicy: (toolName: string) => ToolPersistPolicy;
  private readonly logError: (err: unknown) => void;

  private readonly parts = new Map<string, PendingPart>();
  private readonly richStash = new Map<string, string>();
  private nextPosition = 0;
  private orphanCounter = 0;
  private chunksSinceFlush = 0;
  private flushing = false;
  private prepared = false;

  constructor(
    repo: IMessagesRepository,
    options: StreamingPersisterOptions,
    logError: (err: unknown) => void = () => {},
  ) {
    this.repo = repo;
    this.chatId = options.chatId;
    this.messageId = options.assistantMessageId;
    this.userMessage = options.userMessage;
    this.batchSize = sanitizeBatchSize(options.batchSize ?? BUFFER_BATCH_SIZE);
    this.getToolPolicy = options.getToolPolicy ?? (() => 'immediate');
    this.logError = logError;
  }

  async prepare(): Promise<void> {
    try {
      await this.repo.append(this.chatId, this.userMessage);
      await this.repo.ensureMessage(this.chatId, this.messageId, 'assistant');
      this.prepared = true;
    } catch (err) {
      if (err instanceof StorageWriteError || err instanceof AssemblerError) throw err;
      throw new StorageWriteError('messages', err, {
        chatId: this.chatId,
        messageId: this.messageId,
      });
    }
  }

  async onChunk(chunk: TextStreamPart<ToolSet>): Promise<void> {
    try {
      if (!this.prepared) await this.prepare();

      const key = getChunkKey(chunk);
      let pending = key != null ? this.parts.get(key) : undefined;

      if (!pending && createsPart(chunk)) {
        const row = createPartDraft(this.messageId, this.nextPosition++, chunk);
        const storeKey = key ?? `orphan-${this.orphanCounter++}`;
        pending = { row, inserted: false, dirty: true, raw: '' };
        this.parts.set(storeKey, pending);
        // A rich payload may have arrived before its draft (out-of-band
        // channel). Adopt it now so the tool row carries dataJson.
        const callId = pending.row.toolCallId;
        if (typeof callId === 'string') {
          const stashed = this.richStash.get(callId);
          if (stashed !== undefined) {
            pending.row.dataJson = stashed;
            this.richStash.delete(callId);
          }
        }
      }

      const toolPolicy = pending ? this.resolveToolPolicy(chunk, pending) : undefined;

      if (pending) {
        await applyChunkToDraft(
          pending.row,
          chunk,
          toolPolicy === 'buffered' || toolPolicy === 'write-through' ? pending : undefined,
        );
        backfillErrorInputFromSibling(this.parts, pending);
        pending.dirty = true;
      }

      this.chunksSinceFlush += 1;
      if (shouldFlushImmediately(chunk, toolPolicy) || this.chunksSinceFlush >= this.batchSize) {
        await this.flush();
      }
    } catch (err) {
      // # INTENTIONAL RESILIENT, i think streaming must not abort on persist glitch, correct me if i wrong!.
      // try to enrich to domain error but delegate to apps-provided logError.
      // This is a module design to have besteffort persistence, not a swallow of main operation.
      // Caller stream continues; final reconcile will attempt again. If needed, apps/ can re-throw.
      const domainErr =
        err instanceof StorageWriteError || err instanceof AssemblerError
          ? err
          : new StorageWriteError('message_parts', err, {
              chatId: this.chatId,
              messageId: this.messageId,
              chunkType: chunk.type,
            });
      this.logError(domainErr);
    }
  }

  attachData(toolCallId: string, data: unknown): void {
    let encoded: string;
    try {
      encoded = JSON.stringify(data);
    } catch (err) {
      // # RESILIENT: same contract as onChunk: never break the stream.
      this.logError(
        new StorageWriteError('message_parts', err, {
          chatId: this.chatId,
          messageId: this.messageId,
          toolCallId,
        }),
      );
      return;
    }
    let patched = false;
    const toWrite: NewMessagePartRow[] = [];
    for (const pending of this.parts.values()) {
      if (pending.row.toolCallId === toolCallId) {
        pending.row.dataJson = encoded;
        pending.dirty = true;
        patched = true;
        if (pending.inserted) toWrite.push({ ...pending.row });
      }
    }
    if (!patched) this.richStash.set(toolCallId, encoded);
    if (toWrite.length > 0) {
      void (async () => {
        try {
          await this.repo.updateParts(toWrite);
        } catch (err) {
          // # RESILIENT: same contract as onChunk - never break the stream.
          const domainErr =
            err instanceof StorageWriteError || err instanceof AssemblerError
              ? err
              : new StorageWriteError('message_parts', err, {
                  chatId: this.chatId,
                  messageId: this.messageId,
                  toolCallId,
                });
          this.logError(domainErr);
        }
      })();
    }
  }

  private resolveToolPolicy(
    chunk: TextStreamPart<ToolSet>,
    pending: PendingPart,
  ): ToolPersistPolicy | undefined {
    const toolName = getChunkToolName(chunk) ?? toolNameFromPartType(pending.row.type);
    if (toolName == null) return undefined;
    return this.getToolPolicy(toolName);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const toInsert: PendingPart[] = [];
      const toUpdate: PendingPart[] = [];

      for (const pending of this.parts.values()) {
        if (!pending.dirty) continue;
        if (pending.inserted) toUpdate.push(pending);
        else toInsert.push(pending);
      }

      if (toInsert.length > 0) {
        await this.repo.persistParts(toInsert.map((p) => ({ ...p.row })));
        for (const pending of toInsert) {
          pending.inserted = true;
          pending.dirty = false;
        }
      }

      if (toUpdate.length > 0) {
        await this.repo.updateParts(toUpdate.map((p) => ({ ...p.row })));
        for (const pending of toUpdate) {
          pending.dirty = false;
        }
      }

      this.chunksSinceFlush = 0;
    } finally {
      this.flushing = false;
    }
  }

  async interrupt(): Promise<void> {
    try {
      if (!this.prepared) return;
      await this.flush();
    } catch (err) {
      // # RESILIENT
      // interrupt is best ffort cleanup on abort, log via apps callback, do not crash stream.
      const domainErr =
        err instanceof StorageWriteError
          ? err
          : new StorageWriteError('message_parts', err, {
              chatId: this.chatId,
              messageId: this.messageId,
            });
      this.logError(domainErr);
    }
  }

  async discard(): Promise<void> {
    try {
      if (!this.prepared) return;
      this.parts.clear();
      this.richStash.clear();
      this.chunksSinceFlush = 0;
      await this.repo.deleteMessage(this.chatId, this.messageId);
      this.prepared = false;
    } catch (err) {
      // # RESILIENT
      // discard is best efort cleanup of a failed/cancelled run, log via
      // apps callback, do not crash the caller.
      const domainErr =
        err instanceof StorageWriteError || err instanceof AssemblerError
          ? err
          : new StorageWriteError('messages', err, {
              chatId: this.chatId,
              messageId: this.messageId,
            });
      this.logError(domainErr);
    }
  }

  async finalize(messages: UIMessage[]): Promise<void> {
    try {
      await this.flush();

      const repaired = repairUnresolvedToolCalls(messages);
      if (repaired !== messages) {
        const before = messages.find((m) => m.id === this.messageId)?.parts.length ?? 0;
        const after = repaired.find((m) => m.id === this.messageId)?.parts.length ?? before;
        if (after > before) {
          // # RESILIENT
          // unresolved tool calls due to stream truncate, log via apps callback with structured error, not generic Error
          this.logError(
            new AssemblerError(
              `finalize: repaired ${after - before} unresolved tool call(s) — stream stopped mid-tool (likely hit stepCountIs limit or length limit)`,
              { messageId: this.messageId, before, after },
            ),
          );
        }
      }
      const assistant =
        repaired.find((m) => m.id === this.messageId) ??
        [...repaired].reverse().find((m) => m.role === 'assistant');
      if (!assistant) {
        this.logError(
          new AssemblerError('finalize: assistant message not found in final messages', {
            messageId: this.messageId,
          }),
        );
        return;
      }

      const finalRows = assistant.parts.map((part, index) =>
        UIMessageMapper.partToEntity(this.messageId, index, part),
      );

      await this.repo.reconcileParts(this.messageId, finalRows);
    } catch (err) {
      // # RESILIENT
      // finalize best effort, log structured error via apps callback, do not crash.
      const domainErr =
        err instanceof StorageWriteError || err instanceof AssemblerError
          ? err
          : new StorageWriteError('message_parts', err, {
              chatId: this.chatId,
              messageId: this.messageId,
            });
      this.logError(domainErr);
    }
  }
}
