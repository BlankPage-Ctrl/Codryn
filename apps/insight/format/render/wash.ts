/**
 * Wash section: trail steps first, then every ripple head that matters,
 * loudest first. Zero-caller heads fold into one line.
 *
 * Insight traces carry no ripple walk, so the direct 1-hop CalledBy
 * rollup is the default path here.
 */

import type { InsightNode, InsightRipple, InsightTraceReport } from '../../types.js';

const SHOWN_TESTS = 4;
const SHOWN_FILES = 4;
const SHOWN_NAMES = 6;
const SHOWN_BREAKS = 3;
export const WASH_MAX_ROWS = 12;

export interface WashRow {
  id: string;
  name: string;
  file: string;
  line: number;
  callers: number;
  files: string[];
  tests: string[];
  /** Top breaker ids, file-then-line order, for the Awakening section. */
  breakerIds: string[];
  /** Exact wake total behind the ids (ripple count, else list length). */
  wakeTotal: number;
  fileTotal?: number;
  testTotal?: number;
  truncated: boolean;
  directOnly: boolean;
}

export interface Wash {
  rows: WashRow[];
  /** Zero-caller head names, folded out of the table. */
  folded: string[];
  /** Non-zero heads cut by the cap. */
  overflow: number;
}

/** Steps in path order, then callers>0 heads loudest first. */
export function washRows(
  rep: InsightTraceReport,
  ripples?: Record<string, InsightRipple>,
  maxRows: number = WASH_MAX_ROWS,
): Wash {
  const byId = new Map(rep.nodes.map((n) => [n.id, n] as const));
  const rows: WashRow[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n: InsightNode | undefined = byId.get(id);
    if (!n) return;
    // Breaker ids feed the Awakening section: who wakes if this is
    // edited, file-then-line so one file's callers read as a group.
    const breakerIds = [...n.calledBy]
      .sort(
        (a, b) =>
          (a.filePath < b.filePath ? -1 : 1) - 0 ||
          (a.siteRange?.start ?? a.lineRange.start) - (b.siteRange?.start ?? b.lineRange.start),
      )
      .slice(0, SHOWN_BREAKS * 2 + 2)
      .map((c) => c.id);
    const r = ripples?.[id];
    if (r) {
      rows.push({
        id,
        name: n.name,
        file: n.filePath,
        line: n.lineRange.start,
        callers: r.callers,
        files: r.files ?? [],
        tests: r.tests ?? [],
        breakerIds,
        wakeTotal: r.callers,
        fileTotal: r.fileTotal,
        testTotal: r.testTotal,
        truncated: r.truncated ?? false,
        directOnly: false,
      });
    } else {
      const files = [...new Set(n.calledBy.map((c) => c.filePath))].sort();
      rows.push({
        id,
        name: n.name,
        file: n.filePath,
        line: n.lineRange.start,
        callers: n.calledBy.length,
        files,
        tests: [],
        breakerIds,
        wakeTotal: n.calledBy.length,
        truncated: false,
        directOnly: true,
      });
    }
  };
  for (const t of rep.trails) for (const id of t.steps) push(id);

  const folded: string[] = [];
  let overflow = 0;
  if (ripples) {
    const heads = Object.entries(ripples)
      .filter(([id, r]) => !seen.has(id) && r.callers > 0)
      .sort((a, b) => b[1].callers - a[1].callers || (a[0] < b[0] ? -1 : 1));
    for (const [id] of heads) {
      if (rows.length >= maxRows) {
        overflow++;
        continue;
      }
      push(id);
    }
    // Zero-caller heads are leaves or FTS noise: one folded line, no rows.
    const leaves = Object.entries(ripples)
      .filter(([id, r]) => !seen.has(id) && r.callers <= 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const [id] of leaves) {
      seen.add(id);
      const n = byId.get(id);
      folded.push(n ? `${n.kind} ${qualifiedName(n)} (${n.filePath}:${n.lineRange.start})` : id);
    }
  } else {
    for (const hits of Object.values(rep.anchors)) {
      const first = hits[0];
      if (first && rows.length < maxRows) push(first.id);
    }
  }
  return { rows, folded, overflow };
}

function fmtList(
  items: string[],
  total: number | undefined,
  shown: number,
  truncated: boolean,
): string {
  if (items.length === 0) return '';
  const visible = items.slice(0, shown);
  const head = visible.map((f) => `\`${f}\``).join(', ');
  // Remainder against what is SHOWN, not what was sent.
  const hidden = (total ?? items.length) - visible.length;
  if (hidden > 0) return `${head} +${hidden}`;
  if (truncated) return `${head} …`;
  return head;
}

/** Container-qualified display name: `Program.shutdown`, else bare. */
function qualifiedName(n: InsightNode): string {
  return n.container ? `${n.container.name}.${n.name}` : n.name;
}

/** Markdown table plus the folded leaf line. */
export function renderWash(w: Wash): string {
  if (w.rows.length === 0 && w.folded.length === 0) return '';
  const out = ['## Wash', '', '| symbol | callers | files | tests |', '|---|---|---|---|'];
  for (const r of w.rows) {
    const sym = `${r.name} (${r.file}:${r.line})`;
    const files = fmtList(r.files, r.fileTotal, SHOWN_FILES, r.truncated);
    let tests: string;
    if (r.directOnly) {
      tests = 'direct only';
    } else if ((r.testTotal ?? r.tests.length) === 0) {
      tests = r.truncated ? '…' : 'none within 3 hops';
    } else {
      tests = fmtList(r.tests, r.testTotal, SHOWN_TESTS, r.truncated);
    }
    out.push(`| ${sym} | ${r.callers} | ${files} | ${tests} |`);
  }
  if (w.overflow > 0) out.push(`| … +${w.overflow} more heads | | | |`);
  if (w.folded.length > 0) {
    const names = w.folded.slice(0, SHOWN_NAMES).join(', ');
    const more = w.folded.length > SHOWN_NAMES ? `, +${w.folded.length - SHOWN_NAMES} more` : '';
    out.push('', `_Leaf heads (no callers): ${names}${more}_`);
  }
  return out.join('\n');
}
