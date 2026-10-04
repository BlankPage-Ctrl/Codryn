/**
 * Symbols section: per-symbol depth for the wash rows. Top heads get
 * lists; bodies are intentionally NOT re-rendered here - the ## Code
 * sections already carry the read_file-dense source. This keeps output
 * compact and avoids double-spending the tier envelope.
 */

import type { InsightFunctionRef, InsightNode, InsightTraceReport } from '../../types.js';
import type { WashRow } from './wash.js';
import { numberLines } from './cluster.js';
import { formatOutsideNotice, loadForRender, type RenderCodeReader } from './reader.js';

export const SYMBOL_TOP = 5;
export const SYMBOL_MAX_LINES = 150;
const LIST_FULL = 5;
const LIST_COMPACT = 3;
const RESERVE_SHARE = 0.5;
const RESERVE_MAX = 16000;

type RefLike = { name: string; filePath: string; lineRange: { start: number }; cond?: string };

/** Caller/callee refs as name@file:line with full project-relative path. */
function refs(list: RefLike[], top: number): string {
  if (list.length === 0) return '—';
  const shown = list
    .slice(0, top)
    .map(
      (c) => `\`${c.name}@${c.filePath}:${c.lineRange.start}${c.cond ? ` when ${c.cond}` : ''}\``,
    )
    .join(', ');
  return list.length > top ? `${shown} +${list.length - top}` : shown;
}

function condOf(r: InsightFunctionRef): string | undefined {
  return typeof r.cond === 'string' && r.cond !== '' ? r.cond : undefined;
}

function refLikes(list: InsightFunctionRef[]): RefLike[] {
  return list.map((c) => ({
    name: c.name,
    filePath: c.filePath,
    lineRange: c.lineRange,
    cond: condOf(c),
  }));
}

interface SymbolBlock {
  text: string;
  chars: number;
  full: boolean;
}

function tagsOf(n: InsightNode | undefined): string {
  const tags = n?.tags;
  return tags && tags.length > 0 ? `tags: ${tags.map((t) => `\`${t}\``).join(', ')}` : '';
}

function blockFor(
  row: WashRow,
  node: InsightNode | undefined,
  lines: string[] | null,
  full: boolean,
): SymbolBlock {
  const head = `### ${row.name} (${row.file}:${row.line}) — ${row.callers} callers`;
  if (!full || !node || !lines) {
    const parts = [head, ''];
    if (node) {
      parts.push(`\`${node.signature}\``, '');
      const tags = tagsOf(node);
      if (tags) parts.push(tags, '');
      parts.push(`called by: ${refs(refLikes(node.calledBy), LIST_COMPACT)}`);
      parts.push(`calls: ${refs(refLikes(node.calls), LIST_COMPACT)}`);
    } else {
      parts.push(`called by: ${refs([], LIST_COMPACT)}`);
    }
    const tests =
      row.tests.length > 0
        ? row.tests.map((t) => `\`${t}\``).join(', ')
        : row.directOnly
          ? 'direct only'
          : 'none';
    parts.push(`tests: ${tests}`);
    const text = parts.join('\n');
    return { text, chars: text.length, full: false };
  }
  const start = node.lineRange.start;
  const end = Math.min(node.lineRange.end, start + SYMBOL_MAX_LINES - 1);
  const cut = node.lineRange.end > end;
  const body = numberLines(lines.slice(start - 1, end), start);
  const more = row.file.endsWith('.py') || row.file.endsWith('.pyi') ? '#' : '//';
  const parts = [
    head,
    '',
    `\`${node.signature}\``,
    '',
    '```',
    cut ? `${body}\n${more} … ${node.lineRange.end - end} more lines in body …` : body,
    '```',
    '',
    `called by: ${refs(refLikes(node.calledBy), LIST_FULL)}`,
    `calls: ${refs(refLikes(node.calls), LIST_FULL)}`,
  ];
  const tags = tagsOf(node);
  if (tags) parts.push(tags);
  const tests =
    row.tests.length > 0
      ? row.tests.map((t) => `\`${t}\``).join(', ')
      : row.directOnly
        ? 'direct only'
        : 'none';
  parts.push(`tests: ${tests}`);
  const text = parts.join('\n');
  return { text, chars: text.length, full: true };
}

export interface SymbolsPlan {
  text: string;
  /** Chars the bodies cost: carved from the file envelope. */
  reserve: number;
  full: number;
  /** Files that live outside the workspace - marked, never read. */
  outside: string[];
}

/**
 * Build detail blocks for wash rows. Bodies capped at SYMBOL_MAX_LINES each
 * and RESERVE_SHARE/RESERVE_MAX total; rows that miss the cut (unreadable,
 * stale, or outside-workspace) degrade to lists-only instead of disappearing.
 * Outside files NEVER trigger HITL - they get a manual read_file pointer.
 */
export async function symbolBlocks(
  reader: RenderCodeReader,
  rep: InsightTraceReport,
  rows: WashRow[],
  envelope: number,
): Promise<SymbolsPlan> {
  let allowance = Math.min(RESERVE_MAX, Math.round(envelope * RESERVE_SHARE));
  const blocks: string[] = [];
  const outside: string[] = [];
  let spent = 0;
  let full = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // Matched by (name, file, line): overloads share name+file, never line.
    const node = rep.nodes.find(
      (n) => n.name === row.name && n.filePath === row.file && n.lineRange.start === row.line,
    );
    const indexedEnd = node?.lineRange.end ?? row.line;
    const loaded = await loadForRender(reader, row.file, indexedEnd);
    if (loaded.kind === 'outside') {
      if (!outside.includes(row.file)) outside.push(row.file);
      const b = blockFor(row, node, null, false);
      blocks.push(
        `${b.text}\n${formatOutsideNotice(row.file, node?.lineRange.start ?? row.line, node?.lineRange.end ?? row.line)}`,
      );
      continue;
    }
    const disk = loaded.kind === 'ok' ? loaded.lines : null;
    const bodyLines =
      node && disk ? Math.min(node.lineRange.end - node.lineRange.start + 1, SYMBOL_MAX_LINES) : 0;
    // Rough body cost before rendering: lines x 60 chars. Over-estimates,
    // so the reserve never starves the file envelope on real (shorter) lines.
    const est = bodyLines * 60 + 400;
    if (i < SYMBOL_TOP && bodyLines > 0 && est <= allowance && disk) {
      const b = blockFor(row, node, disk, true);
      blocks.push(b.text);
      allowance -= b.chars;
      spent += b.chars;
      full++;
    } else {
      blocks.push(blockFor(row, node, disk, false).text);
    }
  }
  const text = ['## Symbols', '', ...blocks].join('\n\n');
  return { text, reserve: spent, full, outside };
}
