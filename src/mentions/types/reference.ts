import type { TokenRange } from './token.js';

export interface ResolvedReference {
  id: string;
  name: string;
  range: TokenRange | null;
  value: unknown;
  modelDescription?: string;
  tool?: string;
  error?: { message: string };
}

export interface ToolReference {
  name: string;
  args?: unknown;
}

export interface ResolutionContext {
  workspaceRoot: string;
  resolvePath(relative: string): string;
  signal?: AbortSignal;
  tokenBudget?: number;
}

export interface IReferenceResolver {
  readonly id: string;
  readonly description: string;
  readonly tool?: string;
  resolve(args: string, ctx: ResolutionContext): Promise<ResolvedReference>;
}
