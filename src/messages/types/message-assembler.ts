import type { ModelMessage, UIMessage } from 'ai';

export type AssemblerRole = UIMessage['role'];

export type AssemblerPart = UIMessage['parts'][number];

export interface AssemblerMessageInput {
  id: string;
  role: AssemblerRole;
  parts?: AssemblerPart[];
  metadata?: UIMessage['metadata'];
}

export interface AssemblerAddOptions {
  at?: number;
  id?: string;
}

export interface ReconcileDiff<TPart = AssemblerPart> {
  inserts: Array<{ position: number; part: TPart }>;
  updates: Array<{ position: number; part: TPart }>;
  deletes: Array<{ position: number; id: string }>;
}

export interface IMessageAssembler {
  addMessage(input: AssemblerMessageInput): this;
  upsertMessage(id: string, role: AssemblerRole, parts?: AssemblerPart[]): this;
  addPart(messageId: string, part: AssemblerPart, options?: AssemblerAddOptions): this;
  updatePart(messageId: string, partId: string, patch: Partial<AssemblerPart>): this;
  removePart(messageId: string, partId: string): this;
  removeMessage(id: string): this;
  merge(messages: UIMessage[]): this;
  hasMessage(id: string): boolean;
  getMessage(id: string): UIMessage | undefined;
  getParts(messageId: string): Array<{ id: string; part: AssemblerPart }>;
  resolve(): UIMessage[];
  textOf(messageId: string, options?: { includeSystem?: boolean }): string;
  toModelMessages(): Promise<ModelMessage[]>;
  reconcile<TPart>(
    existing: Array<{ position: number; id: string }>,
    finalParts: TPart[],
  ): ReconcileDiff<TPart>;
}
