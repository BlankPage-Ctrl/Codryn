import type { ParticipantRegistration } from '../types/participant.js';
import type { ResolvedReference, ToolReference } from '../types/reference.js';
import type { ContextPart, MentionRequest } from '../types/request.js';
import type { ChatTurn } from '../types/request.js';
import type { Token, TextToken } from '../types/token.js';

export interface BuildMentionRequestParams {
  originalPrompt: string;
  tokens: Token[];
  participant: ParticipantRegistration | null;
  command: string | null;
  references: ResolvedReference[];
  toolReferences: ToolReference[];
  tokenBudget: number;
  history?: ChatTurn[];
}

export function buildMentionRequest(params: BuildMentionRequestParams): MentionRequest {
  const cleanPrompt = params.tokens
    .filter((token): token is TextToken => token.type === 'TEXT')
    .map((token) => token.value)
    .join('')
    .trim();

  return {
    participant: params.participant
      ? {
          id: params.participant.id,
          name: params.participant.name,
          fullName: params.participant.fullName,
        }
      : null,
    command: params.command,
    cleanPrompt,
    references: params.references,
    toolReferences: params.toolReferences,
    metadata: {
      originalPrompt: params.originalPrompt,
      tokenBudget: params.tokenBudget,
      history: params.history,
    },
  };
}

/**
 * Build a prompt with references inlined (Strategy B). Routing tokens
 * (PARTICIPANT/COMMAND) are dropped; references become their model description.
 */
export function buildInlinePrompt(tokens: Token[], references: ResolvedReference[]): string {
  let out = '';
  for (const token of tokens) {
    if (token.type === 'TEXT') {
      out += token.value;
      continue;
    }
    if (token.type === 'REFERENCE') {
      const ref = references.find(
        (r) => r.range && r.range.start === token.range.start && r.range.end === token.range.end,
      );
      out += ref?.modelDescription ?? '';
    }
  }
  return out.trim();
}

export function toContextParts(references: ResolvedReference[]): ContextPart[] {
  return references.map((ref) => ({
    id: ref.id,
    name: ref.name,
    value: ref.value,
    modelDescription: ref.modelDescription,
    error: ref.error,
  }));
}
