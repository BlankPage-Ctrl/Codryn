import type {
  EditOperation,
  EditFailureDetails,
  EditFailureReason,
  EditMatch,
} from '../types/edit.js';
import { EditFailedError } from '../errors/edit.js';
export { EditFailedError } from '../errors/edit.js';

interface ResolvedEdit {
  editIndex: number;
  search: string;
  replace: string;
  hint?: { startLine?: number; endLine?: number };
  index: number;
  line: number;
  endIndex: number;
}

const HINT_TOLERANCE = 3;

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function findAllIndices(content: string, search: string): number[] {
  const indices: number[] = [];
  let pos = 0;
  while (true) {
    const idx = content.indexOf(search, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + search.length;
    if (search.length === 0) break;
  }
  return indices;
}

function formatSnippet(search: string, maxLen = 60): string {
  const oneLine = search.split('\n')[0] ?? '';
  if (oneLine.length > maxLen) return `${oneLine.slice(0, maxLen)}...`;
  return oneLine;
}

function toMatch(content: string, index: number): EditMatch {
  const line = lineNumberAt(content, index);
  const lines = content.split('\n');
  const text = lines[line - 1] ?? '';
  const preview = text.length > 80 ? `${text.slice(0, 80)}...` : text;
  return { index, line, preview };
}

function makeDetails(
  editIndex: number,
  reason: EditFailureReason,
  search: string,
  hint: { startLine?: number; endLine?: number } | undefined,
  matches: EditMatch[],
  totalEdits: number,
  extra?: Partial<EditFailureDetails>,
): EditFailureDetails {
  return {
    editIndex,
    reason,
    search,
    searchPreview: formatSnippet(search),
    ...(hint !== undefined ? { hint } : {}),
    matches,
    totalEdits,
    ...extra,
  };
}

export function resolveEdits(content: string, edits: EditOperation[]): ResolvedEdit[] {
  const resolved: ResolvedEdit[] = [];
  const totalEdits = edits.length;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const search = edit.search;
    const hint = edit.hint;

    const allIndices = findAllIndices(content, search);

    if (allIndices.length === 0) {
      throw new EditFailedError(makeDetails(i, 'NOT_FOUND', search, hint, [], totalEdits));
    }

    if (!hint || (hint.startLine === undefined && hint.endLine === undefined)) {
      if (allIndices.length > 1) {
        const matches = allIndices.map((idx) => toMatch(content, idx));
        throw new EditFailedError(makeDetails(i, 'AMBIGUOUS', search, hint, matches, totalEdits));
      }
      const idx = allIndices[0];
      resolved.push({
        editIndex: i,
        search,
        replace: edit.replace,
        hint,
        index: idx,
        line: lineNumberAt(content, idx),
        endIndex: idx + search.length,
      });
      continue;
    }

    const startLine = hint.startLine ?? hint.endLine ?? 1;
    const endLine = hint.endLine ?? hint.startLine ?? content.split('\n').length;
    const expandedStart = Math.max(1, startLine - HINT_TOLERANCE);
    const expandedEnd = endLine + HINT_TOLERANCE;

    const candidates = allIndices
      .map((idx) => ({ idx, line: lineNumberAt(content, idx) }))
      .filter(({ line }) => line >= expandedStart && line <= expandedEnd);

    if (candidates.length === 0) {
      const allMatchesOutsideHint = allIndices.map((idx) => toMatch(content, idx));
      throw new EditFailedError(
        makeDetails(i, 'NOT_FOUND_IN_HINT', search, hint, [], totalEdits, {
          expandedRange: { start: expandedStart, end: expandedEnd },
          allMatchesOutsideHint,
        }),
      );
    }

    if (candidates.length > 1) {
      const matches = candidates.map((c) => toMatch(content, c.idx));
      throw new EditFailedError(
        makeDetails(i, 'AMBIGUOUS_IN_HINT', search, hint, matches, totalEdits, {
          expandedRange: { start: expandedStart, end: expandedEnd },
        }),
      );
    }

    resolved.push({
      editIndex: i,
      search,
      replace: edit.replace,
      hint,
      index: candidates[0].idx,
      line: candidates[0].line,
      endIndex: candidates[0].idx + search.length,
    });
  }

  return resolved;
}

function checkOverlaps(resolved: ResolvedEdit[], totalEdits: number): void {
  const sorted = [...resolved].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.endIndex > next.index) {
      throw new EditFailedError({
        editIndex: next.editIndex,
        reason: 'OVERLAP',
        search: next.search,
        searchPreview: formatSnippet(next.search),
        hint: next.hint,
        matches: [
          { index: cur.index, line: cur.line, preview: '' },
          { index: next.index, line: next.line, preview: '' },
        ],
        overlappingWith: cur.editIndex,
        totalEdits,
      });
    }
  }
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function usesCrlf(content: string): boolean {
  return content.includes('\r\n');
}

export function applyEditsAtomic(
  content: string,
  edits: EditOperation[],
  applyOrder: 'reverse' | 'forward' = 'reverse',
): string {
  // CRLF tolerance: agent `search`/`replace` blocks are almost always LF,
  // while Windows checkouts are CRLF. Match in LF space, then restore the
  // file's dominant CRLF style so the write preserves line endings instead
  // of failing with NOT_FOUND or silently converting the file to LF.
  if (!usesCrlf(content)) {
    return applyEditsAtomicInner(content, edits, applyOrder);
  }
  const normEdits = edits.map((e) => ({
    ...e,
    search: normalizeLf(e.search),
    replace: normalizeLf(e.replace),
  }));
  const resultLf = applyEditsAtomicInner(normalizeLf(content), normEdits, applyOrder);
  return resultLf.replace(/\n/g, '\r\n');
}

function applyEditsAtomicInner(
  content: string,
  edits: EditOperation[],
  applyOrder: 'reverse' | 'forward' = 'reverse',
): string {
  const resolved = resolveEdits(content, edits);
  checkOverlaps(resolved, edits.length);

  if (applyOrder === 'reverse') {
    const sorted = [...resolved].sort((a, b) => b.index - a.index);
    let next = content;
    for (const r of sorted) {
      next = next.slice(0, r.index) + r.replace + next.slice(r.index + r.search.length);
    }
    return next;
  }

  const sorted = [...resolved].sort((a, b) => a.index - b.index);
  let next = content;
  let delta = 0;
  for (const r of sorted) {
    const adjusted = r.index + delta;
    next = next.slice(0, adjusted) + r.replace + next.slice(adjusted + r.search.length);
    delta += r.replace.length - r.search.length;
  }
  return next;
}
