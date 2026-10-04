import type { CommandRegistration, ParticipantRegistration } from '../types/participant.js';
import type { IReferenceResolver } from '../types/reference.js';
import type { MentionSuggestion } from '../types/request.js';
import { detectPrefixAt } from './lexer.js';

export interface CompletionSource {
  participants: ParticipantRegistration[];
  commands: CommandRegistration[];
  resolvers: IReferenceResolver[];
}

/**
 * Suggest mention completions for the trigger (`@`, `/`, `#`) at `position`.
 *
 * @example
 * provideCompletions('read #fi', 7, source)
 */
export function provideCompletions(
  input: string,
  position: number,
  source: CompletionSource,
): MentionSuggestion[] {
  const hit = detectPrefixAt(input, position);
  if (!hit) return [];
  const range = { start: hit.start, end: position };
  const prefix = hit.prefix.toLowerCase();

  if (hit.kind === '@') {
    return source.participants
      .filter((p) => p.name.toLowerCase().startsWith(prefix))
      .map((p) => ({
        kind: 'participant' as const,
        label: `@${p.name}`,
        detail: p.description,
        insertText: `@${p.name}`,
        range,
      }));
  }

  if (hit.kind === '/') {
    return source.commands
      .filter((c) => c.name.toLowerCase().startsWith(prefix))
      .map((c) => ({
        kind: 'command' as const,
        label: `/${c.name}`,
        detail: c.description,
        insertText: `/${c.name}`,
        range,
      }));
  }

  return source.resolvers
    .filter((r) => r.id.toLowerCase().startsWith(prefix))
    .map((r) => ({
      kind: 'reference' as const,
      label: `#${r.id}`,
      detail: r.description,
      insertText: `#${r.id}`,
      range,
    }));
}
