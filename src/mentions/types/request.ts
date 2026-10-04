import { z } from 'zod';
import type { ResolvedReference, ToolReference, ResolutionContext } from './reference.js';
import type { TokenRange } from './token.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface MentionRequest {
  participant: { id: string; name: string; fullName: string } | null;
  command: string | null;
  cleanPrompt: string;
  references: ResolvedReference[];
  toolReferences: ToolReference[];
  metadata: {
    originalPrompt: string;
    tokenBudget: number;
    history?: ChatTurn[];
  };
}

export interface MentionParseOptions {
  tokenBudget?: number;
  history?: ChatTurn[];
  signal?: AbortSignal;
  context: ResolutionContext;
}

export interface ContextPart {
  id: string;
  name: string;
  value: unknown;
  modelDescription?: string;
  error?: { message: string };
}

export type MentionSuggestionKind = 'participant' | 'command' | 'reference';

export interface MentionSuggestion {
  kind: MentionSuggestionKind;
  label: string;
  detail?: string;
  insertText: string;
  range: TokenRange;
}

export const MentionInputSchema = z
  .string()
  .max(50_000, 'mention prompt exceeds 50,000 characters');

export type { ResolvedReference, ToolReference, ResolutionContext } from './reference.js';
export type { TokenRange } from './token.js';
