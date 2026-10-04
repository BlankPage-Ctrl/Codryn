import type { Token } from '../types/token.js';

const NAME_RE = /[a-zA-Z0-9_.-]/;

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function readNameEnd(input: string, start: number): number {
  let i = start;
  while (i < input.length && NAME_RE.test(input[i])) i += 1;
  return i;
}

/**
 * Tokenize a raw prompt into mention tokens.
 *
 * Parsing rules:
 * - A leading `@name` (after optional whitespace) is a PARTICIPANT token.
 * - A leading `/name` (with or without a participant) is a COMMAND token.
 * - A `#kind[:args]` anywhere is a REFERENCE token; args run until whitespace.
 * - Anything else (including `@`/`/` mid-prompt) is a TEXT token.
 *
 * @example
 * tokenize('@workspace /explain #file:src/utils.ts refactor this')
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let cursor = 0;

  while (cursor < n && isWhitespace(input[cursor])) cursor += 1;

  if (input[cursor] === '@') {
    const nameEnd = readNameEnd(input, cursor + 1);
    if (nameEnd > cursor + 1) {
      tokens.push({
        type: 'PARTICIPANT',
        name: input.slice(cursor + 1, nameEnd),
        range: { start: cursor, end: nameEnd },
        raw: input.slice(cursor, nameEnd),
      });
      cursor = nameEnd;
      while (cursor < n && isWhitespace(input[cursor])) cursor += 1;

      if (input[cursor] === '/') {
        const commandEnd = readNameEnd(input, cursor + 1);
        if (commandEnd > cursor + 1) {
          tokens.push({
            type: 'COMMAND',
            name: input.slice(cursor + 1, commandEnd),
            range: { start: cursor, end: commandEnd },
            raw: input.slice(cursor, commandEnd),
          });
          cursor = commandEnd;
        }
      }
    }
  } else if (input[cursor] === '/') {
    const commandEnd = readNameEnd(input, cursor + 1);
    if (commandEnd > cursor + 1) {
      tokens.push({
        type: 'COMMAND',
        name: input.slice(cursor + 1, commandEnd),
        range: { start: cursor, end: commandEnd },
        raw: input.slice(cursor, commandEnd),
      });
      cursor = commandEnd;
    }
  }

  let textStart = cursor;
  while (cursor < n) {
    if (input[cursor] === '#') {
      const kindEnd = readNameEnd(input, cursor + 1);
      if (kindEnd > cursor + 1) {
        if (textStart < cursor) {
          tokens.push({
            type: 'TEXT',
            value: input.slice(textStart, cursor),
            range: { start: textStart, end: cursor },
            raw: input.slice(textStart, cursor),
          });
        }

        let end = kindEnd;
        let args = '';
        if (input[end] === ':') {
          const argStart = end + 1;
          let j = argStart;
          while (j < n && !isWhitespace(input[j])) j += 1;
          end = j;
          args = input.slice(argStart, end);
        }

        tokens.push({
          type: 'REFERENCE',
          kind: input.slice(cursor + 1, kindEnd),
          args,
          range: { start: cursor, end },
          raw: input.slice(cursor, end),
        });
        cursor = end;
        textStart = cursor;
        continue;
      }
    }
    cursor += 1;
  }

  if (textStart < n) {
    tokens.push({
      type: 'TEXT',
      value: input.slice(textStart, n),
      range: { start: textStart, end: n },
      raw: input.slice(textStart, n),
    });
  }

  return tokens;
}

export interface PrefixHit {
  kind: '@' | '#' | '/';
  prefix: string;
  start: number;
}

/**
 * Detect an incomplete mention trigger before `position`.
 *
 * @example
 * detectPrefixAt('read #fi', 7) // { kind: '#', prefix: 'fi', start: 5 }
 */
export function detectPrefixAt(input: string, position: number): PrefixHit | null {
  let i = Math.min(position, input.length);
  while (i > 0 && NAME_RE.test(input[i - 1])) i -= 1;
  const trigger = i > 0 ? input[i - 1] : '';
  if (trigger !== '@' && trigger !== '#' && trigger !== '/') return null;
  return { kind: trigger, prefix: input.slice(i, position), start: i - 1 };
}
