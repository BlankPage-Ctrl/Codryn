import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import type {
  AssemblerAddOptions,
  AssemblerMessageInput,
  AssemblerPart,
  AssemblerRole,
  IMessageAssembler,
  ReconcileDiff,
} from '../types/message-assembler.js';
import { repairUnresolvedToolCalls } from './repair.js';
import { AssemblerError } from '../errors/assembler.js';
import { ConflictError } from '../errors/storage.js';

interface InternalPart {
  id: string;
  position: number;
  part: AssemblerPart;
}

interface InternalMessage {
  id: string;
  role: AssemblerRole;
  order: number;
  metadata?: UIMessage['metadata'];
  parts: InternalPart[];
}

function createPartId(): string {
  return crypto.randomUUID();
}

function isTextPart(part: AssemblerPart): part is {
  type: 'text';
  text: string;
  isSystem?: boolean;
} {
  return part.type === 'text';
}

export class MessageAssembler implements IMessageAssembler {
  private readonly messages = new Map<string, InternalMessage>();
  private nextOrder = 0;

  addMessage(input: AssemblerMessageInput): this {
    if (this.messages.has(input.id)) {
      throw new ConflictError(`MessageAssembler: message "${input.id}" already exists`, {
        messageId: input.id,
      });
    }
    const msg: InternalMessage = {
      id: input.id,
      role: input.role,
      order: this.nextOrder++,
      metadata: input.metadata,
      parts: (input.parts ?? []).map((part, position) => ({
        id: createPartId(),
        position,
        part,
      })),
    };
    this.messages.set(input.id, msg);
    return this;
  }

  upsertMessage(id: string, role: AssemblerRole, parts?: AssemblerPart[]): this {
    if (this.messages.has(id)) return this;
    return this.addMessage({ id, role, parts });
  }

  addPart(messageId: string, part: AssemblerPart, options?: AssemblerAddOptions): this {
    const msg = this.requireMessage(messageId);
    const position = options?.at ?? msg.parts.length;
    for (const existing of msg.parts) {
      if (existing.position >= position) existing.position += 1;
    }
    msg.parts.push({
      id: options?.id ?? createPartId(),
      position,
      part,
    });
    this.sortParts(msg);
    return this;
  }

  updatePart(messageId: string, partId: string, patch: Partial<AssemblerPart>): this {
    const msg = this.requireMessage(messageId);
    const target = msg.parts.find((p) => p.id === partId);
    if (!target) {
      throw new AssemblerError(
        `MessageAssembler: part "${partId}" not found in message "${messageId}"`,
        { messageId, partId },
      );
    }
    target.part = { ...target.part, ...patch } as AssemblerPart;
    return this;
  }

  removePart(messageId: string, partId: string): this {
    const msg = this.requireMessage(messageId);
    const index = msg.parts.findIndex((p) => p.id === partId);
    if (index === -1) {
      throw new AssemblerError(
        `MessageAssembler: part "${partId}" not found in message "${messageId}"`,
        { messageId, partId },
      );
    }
    msg.parts.splice(index, 1);
    this.reindex(msg);
    return this;
  }

  removeMessage(id: string): this {
    this.messages.delete(id);
    return this;
  }

  merge(messages: UIMessage[]): this {
    for (const message of messages) {
      if (this.messages.has(message.id)) continue;
      this.addMessage({
        id: message.id,
        role: message.role,
        metadata: message.metadata,
        parts: message.parts,
      });
    }
    return this;
  }

  hasMessage(id: string): boolean {
    return this.messages.has(id);
  }

  getMessage(id: string): UIMessage | undefined {
    const msg = this.messages.get(id);
    if (!msg) return undefined;
    return {
      id: msg.id,
      role: msg.role,
      parts: this.sortedParts(msg).map((p) => p.part),
      ...(msg.metadata !== undefined ? { metadata: msg.metadata } : {}),
    };
  }

  getParts(messageId: string): Array<{ id: string; part: AssemblerPart }> {
    const msg = this.requireMessage(messageId);
    return this.sortedParts(msg).map((p) => ({ id: p.id, part: p.part }));
  }

  resolve(): UIMessage[] {
    return [...this.messages.values()]
      .sort((a, b) => a.order - b.order)
      .map((msg) => this.getMessage(msg.id)!);
  }

  textOf(messageId: string, options?: { includeSystem?: boolean }): string {
    const msg = this.requireMessage(messageId);
    let out = '';
    for (const { part } of this.sortedParts(msg)) {
      if (!isTextPart(part)) continue;
      if (!options?.includeSystem && part.isSystem) continue;
      out += part.text;
    }
    return out;
  }

  async toModelMessages(): Promise<ModelMessage[]> {
    return convertToModelMessages(repairUnresolvedToolCalls(this.resolve()));
  }

  reconcile<TPart>(
    existing: Array<{ position: number; id: string }>,
    finalParts: TPart[],
  ): ReconcileDiff<TPart> {
    const byPosition = new Map(existing.map((row) => [row.position, row]));
    const inserts: ReconcileDiff<TPart>['inserts'] = [];
    const updates: ReconcileDiff<TPart>['updates'] = [];
    const keptIds = new Set<string>();

    for (let position = 0; position < finalParts.length; position++) {
      const match = byPosition.get(position);
      if (match) {
        updates.push({ position, part: finalParts[position] });
        keptIds.add(match.id);
      } else {
        inserts.push({ position, part: finalParts[position] });
      }
    }

    const deletes = existing
      .filter((row) => row.position >= finalParts.length && !keptIds.has(row.id))
      .map((row) => ({ position: row.position, id: row.id }));

    return { inserts, updates, deletes };
  }

  private requireMessage(id: string): InternalMessage {
    const msg = this.messages.get(id);
    if (!msg) {
      throw new AssemblerError(`MessageAssembler: message "${id}" not found`, { messageId: id });
    }
    return msg;
  }

  private sortedParts(msg: InternalMessage): InternalPart[] {
    return msg.parts.slice().sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  private sortParts(msg: InternalMessage): void {
    msg.parts.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  private reindex(msg: InternalMessage): void {
    msg.parts
      .sort((a, b) => a.position - b.position)
      .forEach((part, index) => {
        part.position = index;
      });
  }
}
