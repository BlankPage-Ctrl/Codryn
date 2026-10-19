import type { ISensitiveMatcher } from '../types/sensitive.js';

type Rule =
  | { kind: 'file'; regex: RegExp; negate: boolean }
  | { kind: 'segment'; name: string; negate: boolean };

/**
 * Matches file names against a caller-provided pattern list.
 *
 * Supported forms: exact (`.env`), wildcard (`.env*`, `*.pem`),
 * directory segment (`.ssh/`), and negation (`!.env.example`).
 * Rules evaluate in order and the last match wins, so negations must
 * come after the positive rules they override.
 */
export class SensitiveMatcher implements ISensitiveMatcher {
  private readonly rules: Rule[] = [];

  constructor(patterns: readonly string[] = []) {
    for (const raw of patterns) {
      const parsed = parsePattern(raw);
      if (!parsed) continue;
      if (parsed.kind === 'segment') {
        this.rules.push({
          kind: 'segment',
          name: parsed.value.toLowerCase(),
          negate: parsed.negate,
        });
      } else {
        this.rules.push({
          kind: 'file',
          regex: toRegExp(parsed.value),
          negate: parsed.negate,
        });
      }
    }
  }

  isSensitive(targetPath: string): boolean {
    const segments = targetPath.split(/[\\/]+/).filter((part) => part.length > 0);
    if (segments.length === 0) return false;
    const name = segments[segments.length - 1] ?? '';
    const lowerSegments = segments.map((part) => part.toLowerCase());

    let sensitive = false;
    for (const rule of this.rules) {
      const matched =
        rule.kind === 'segment' ? lowerSegments.includes(rule.name) : rule.regex.test(name);
      if (matched) sensitive = !rule.negate;
    }
    return sensitive;
  }
}

type ParsedPattern =
  | { kind: 'file'; value: string; negate: boolean }
  | { kind: 'segment'; value: string; negate: boolean };

function parsePattern(raw: string): ParsedPattern | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const negate = trimmed.startsWith('!');
  const body = negate ? trimmed.slice(1) : trimmed;
  if (body === '') return null;

  if (body.endsWith('/')) {
    return { kind: 'segment', value: body.slice(0, -1), negate };
  }
  return { kind: 'file', value: body, negate };
}

function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
