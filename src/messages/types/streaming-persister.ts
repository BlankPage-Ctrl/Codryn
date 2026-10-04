import type { TextStreamPart, ToolSet, UIMessage } from 'ai';

export type ToolPersistPolicy = 'immediate' | 'buffered' | 'write-through';

export interface StreamingPersisterOptions {
  chatId: string;
  userMessage: UIMessage;
  assistantMessageId: string;
  batchSize?: number;
  getToolPolicy?: (toolName: string) => ToolPersistPolicy;
}

export interface IStreamingPersister<TOOLS extends ToolSet = ToolSet> {
  prepare(): Promise<void>;
  onChunk(chunk: TextStreamPart<TOOLS>): Promise<void>;
  attachData(toolCallId: string, data: unknown): void;
  flush(): Promise<void>;
  finalize(messages: UIMessage[]): Promise<void>;
  interrupt(): Promise<void>;
  discard(): Promise<void>;
}
