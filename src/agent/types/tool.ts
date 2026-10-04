import { z } from 'zod';

export interface AgentToolExecuteOptions {
  toolCallId?: string;
}

export interface AgentTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;

  execute: (args: z.infer<TSchema>, options?: AgentToolExecuteOptions) => unknown;
}
