import { EditFileInputSchema, type EditFileInput } from '../../../src/fm/index.js';
import { ValidationError } from '../../shared/errors.js';

/**
 * ```
 * <relative-path>
 * <<<<<<< SEARCH [lines <start>[-<end>] [(hint)]]
 * <exact search text>
 * =======
 * <replacement text (may be empty = delete)>
 * >>>>>>> REPLACE
 * ```
 *
 * - The first non-empty line is the workspace-relative file path.
 * - One or more SEARCH/REPLACE blocks follow. The `lines ...` hint is
 *   optional; when absent the fm engine resolves by uniqueness and
 *   reports AMBIGUOUS on multiple matches.
 * - A surrounding markdown code fence is stripped when present.
 */
export const SEARCH_HEADER_PREFIX = '<<<<<<< SEARCH';
export const SEARCH_SEPARATOR = '=======';
export const REPLACE_FOOTER = '>>>>>>> REPLACE';

/** Rejects oversized LLM payloads before parsing (see request size limits). */
export const MAX_RAW_CHARS = 200_000;
/** Caps blocks per message so one tool call cannot rewrite a whole repo. */
export const MAX_EDIT_BLOCKS = 50;
/** Mirrors common filesystem path limits; traversal is enforced later by fm. */
export const MAX_PATH_CHARS = 1024;

export interface ParseEditErrorDetails {
  blockIndex?: number;
  line?: number;
}

export class ParseEditError extends ValidationError {
  public readonly details: ParseEditErrorDetails;

  constructor(message: string, details: ParseEditErrorDetails = {}) {
    super(message);
    this.name = 'ParseEditError';
    this.details = details;
  }
}

const HINT_PATTERN = /^lines\s+(\d+)(?:\s*-\s*(\d+))?\s*(?:\(hint\))?$/i;

function isSearchHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === SEARCH_HEADER_PREFIX || trimmed.startsWith(`${SEARCH_HEADER_PREFIX} `);
}

function isSeparator(line: string): boolean {
  return line.trim() === SEARCH_SEPARATOR;
}

function isReplaceFooter(line: string): boolean {
  return line.trim() === REPLACE_FOOTER;
}

function isAnyDelimiter(line: string): boolean {
  return isSearchHeader(line) || isSeparator(line) || isReplaceFooter(line);
}

function stripCodeFence(normalized: string): string {
  const trimmed = normalized.trim();
  if (!trimmed.startsWith('```')) return normalized;
  const lines = trimmed.split('\n');
  lines.shift();
  for (let end = lines.length - 1; end >= 0; end--) {
    const candidate = lines[end];
    if (candidate === undefined) continue;
    if (candidate.trimStart().startsWith('```')) {
      lines.length = end;
      break;
    }
  }
  return lines.join('\n');
}

function cleanPath(raw: string): string {
  let path = raw.trim();
  for (;;) {
    if (path.length >= 2 && path.startsWith('`') && path.endsWith('`')) {
      path = path.slice(1, -1).trim();
      continue;
    }
    if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).trim();
      continue;
    }
    if (path.length >= 2 && path.startsWith("'") && path.endsWith("'")) {
      path = path.slice(1, -1).trim();
      continue;
    }
    return path;
  }
}

/** Drops blank padding lines. inner indentation is preserved verbatim. */
function joinVerbatim(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end) {
    const line = lines[start];
    if (line !== undefined && line.trim() !== '') break;
    start++;
  }
  while (end > start) {
    const line = lines[end - 1];
    if (line !== undefined && line.trim() !== '') break;
    end--;
  }
  return lines.slice(start, end).join('\n');
}

function parseHint(
  header: string,
  blockIndex: number,
  line: number,
): { startLine?: number; endLine?: number } | undefined {
  const rest = header.trim().slice(SEARCH_HEADER_PREFIX.length).trim();
  if (rest === '') return undefined;
  const match = HINT_PATTERN.exec(rest);
  if (!match) {
    throw new ParseEditError(
      `block ${blockIndex + 1} (line ${line}): invalid hint "${rest}". ` +
        `Format: "${SEARCH_HEADER_PREFIX}" or "${SEARCH_HEADER_PREFIX} lines <start>[-<end>] (hint)"`,
      { blockIndex, line },
    );
  }
  const startLine = Number.parseInt(match[1] ?? '', 10);
  const endLine = match[2] !== undefined ? Number.parseInt(match[2], 10) : startLine;
  if (!Number.isSafeInteger(startLine) || startLine < 1) {
    throw new ParseEditError(
      `block ${blockIndex + 1} (line ${line}): startLine must be an integer >= 1, got "${match[1]}"`,
      { blockIndex, line },
    );
  }
  if (!Number.isSafeInteger(endLine) || endLine < 1) {
    throw new ParseEditError(
      `block ${blockIndex + 1} (line ${line}): endLine must be an integer >= 1, got "${match[2]}"`,
      { blockIndex, line },
    );
  }
  if (startLine > endLine) {
    throw new ParseEditError(
      `block ${blockIndex + 1} (line ${line}): startLine (${startLine}) > endLine (${endLine})`,
      { blockIndex, line },
    );
  }
  return { startLine, endLine };
}

/**
 * Parses a raw AI edit message into a validated `EditFileInput` ready for
 * `EditFileService.editFile`. Throws `ParseEditError` (a `ValidationError`,
 * code VALIDATION_FAILED) with an LLM-actionable message on any malformed
 * input, the message is returned to the model so it can retry.
 */
export function parseEditInput(raw: unknown): EditFileInput {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ParseEditError('empty input: send a file path plus at least 1 SEARCH/REPLACE block');
  }
  if (raw.length > MAX_RAW_CHARS) {
    throw new ParseEditError(
      `input too large (${raw.length} chars, max ${MAX_RAW_CHARS}). Split into multiple messages.`,
    );
  }

  const lines = stripCodeFence(raw.replace(/\r\n?/g, '\n')).split('\n');

  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line !== undefined && line.trim() !== '') break;
    cursor++;
  }
  if (cursor >= lines.length) {
    throw new ParseEditError('empty input: send a file path plus at least 1 SEARCH/REPLACE block');
  }
  const pathLine = lines[cursor] ?? '';
  if (isAnyDelimiter(pathLine)) {
    throw new ParseEditError(
      `line ${cursor + 1}: first line must be a relative file path, not a delimiter. Got "${pathLine.trim()}"`,
      { line: cursor + 1 },
    );
  }
  const path = cleanPath(pathLine);
  if (path === '') {
    throw new ParseEditError(`line ${cursor + 1}: file path is empty`, { line: cursor + 1 });
  }
  if (path.length > MAX_PATH_CHARS) {
    throw new ParseEditError(
      `line ${cursor + 1}: path too long (${path.length} chars, max ${MAX_PATH_CHARS})`,
      { line: cursor + 1 },
    );
  }
  cursor++;

  const edits: Array<{
    search: string;
    replace: string;
    hint?: { startLine?: number; endLine?: number };
  }> = [];
  let index = cursor;
  while (index < lines.length) {
    while (index < lines.length) {
      const line = lines[index];
      if (line !== undefined && line.trim() !== '') break;
      index++;
    }
    if (index >= lines.length) break;

    const header = lines[index] ?? '';
    const headerLine = index + 1;
    if (!isSearchHeader(header)) {
      throw new ParseEditError(
        `line ${headerLine}: expected "${SEARCH_HEADER_PREFIX}", got "${header.trim()}". ` +
          `Each edit must open with "${SEARCH_HEADER_PREFIX}"`,
        { blockIndex: edits.length, line: headerLine },
      );
    }
    const hint = parseHint(header, edits.length, headerLine);
    index++;

    const searchLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (isSeparator(line)) break;
      if (isSearchHeader(line) || isReplaceFooter(line)) {
        throw new ParseEditError(
          `block ${edits.length + 1} (line ${index + 1}): missing "${SEARCH_SEPARATOR}" SEARCH/REPLACE separator`,
          { blockIndex: edits.length, line: index + 1 },
        );
      }
      searchLines.push(line);
      index++;
    }
    if (index >= lines.length) {
      throw new ParseEditError(
        `block ${edits.length + 1}: missing "${SEARCH_SEPARATOR}" SEARCH/REPLACE separator`,
        { blockIndex: edits.length, line: headerLine },
      );
    }
    index++;

    const replaceLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (isReplaceFooter(line)) break;
      if (isSearchHeader(line) || isSeparator(line)) {
        throw new ParseEditError(
          `block ${edits.length + 1} (line ${index + 1}): missing "${REPLACE_FOOTER}" block terminator`,
          { blockIndex: edits.length, line: index + 1 },
        );
      }
      replaceLines.push(line);
      index++;
    }
    if (index >= lines.length) {
      throw new ParseEditError(
        `block ${edits.length + 1}: missing "${REPLACE_FOOTER}" block terminator`,
        { blockIndex: edits.length, line: headerLine },
      );
    }
    index++;

    const search = joinVerbatim(searchLines);
    if (search === '') {
      throw new ParseEditError(
        `block ${edits.length + 1} (line ${headerLine}): empty SEARCH section. SEARCH must contain exact text from the file`,
        { blockIndex: edits.length, line: headerLine },
      );
    }
    const replace = joinVerbatim(replaceLines);
    if (hint === undefined) {
      edits.push({ search, replace });
    } else {
      edits.push({ search, replace, hint });
    }
    if (edits.length > MAX_EDIT_BLOCKS) {
      throw new ParseEditError(
        `too many edit blocks (${edits.length}, max ${MAX_EDIT_BLOCKS}). Split into multiple messages.`,
        { blockIndex: edits.length - 1 },
      );
    }
  }

  if (edits.length === 0) {
    throw new ParseEditError(
      `path "${path}" has no edit blocks: add at least 1 "${SEARCH_HEADER_PREFIX} … ${SEARCH_SEPARATOR} … ${REPLACE_FOOTER}" block`,
    );
  }

  const parsed = EditFileInputSchema.safeParse({ path, edits, apply_order: 'reverse' });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ParseEditError(`EditFileInput validation failed: ${msg}`);
  }
  return parsed.data;
}
