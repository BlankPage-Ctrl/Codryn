export interface UnifiedDiffOptions {
  // Unchanged lines shown around each change. Defaults to 3.
  context?: number;
  // Skip the diff when either side exceeds this many lines. Defaults to 2000.
  maxInputLines?: number;
  // Abort Myers when the edit distance exceeds this. Defaults to 1000.
  maxDelta?: number;
  // Cap emitted diff lines (hunk content). Defaults to 300.
  maxOutputLines?: number;
}

export interface UnifiedDiffResult {
  // Unified diff with `@@ -a,b +c,d @@` hunk headers, '' when identical.
  diff: string;
  // True when the diff was skipped or cut off by a cap.
  truncated: boolean;
}

const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_INPUT_LINES = 2000;
const DEFAULT_MAX_DELTA = 1000;
const DEFAULT_MAX_OUTPUT_LINES = 300;

type LineEdit =
  | { kind: 'equal'; a: number; b: number }
  | { kind: 'delete'; a: number }
  | { kind: 'insert'; b: number };

function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (content.endsWith('\n')) lines.pop();
  return lines;
}

/**
 * Greedy Myers diff on lines. Returns undefined when the edit distance
 * exceeds maxDelta (caller falls back to a truncated result).
 * Trace snapshots are stored compactly (2d+1 entries each) so memory
 * stays bounded by O(D^2) instead of O((N+M)*D).
 */
function myers(a: string[], b: string[], maxDelta: number): LineEdit[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, j) => ({ kind: 'insert', b: j }) as LineEdit);
  if (m === 0) return a.map((_, i) => ({ kind: 'delete', a: i }) as LineEdit);

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1).fill(-1);
  const trace: Int32Array[] = [];
  let solution = -1;

  const limit = Math.min(max, maxDelta);
  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        solution = d;
        break;
      }
    }
    const snap = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k++) {
      snap[k + d] = v[offset + k];
    }
    trace.push(snap);
    if (solution !== -1) break;
  }

  if (solution === -1) return undefined;

  const edits: LineEdit[] = [];
  let x = n;
  let y = m;
  for (let d = solution; d >= 1; d--) {
    const prev = trace[d - 1];
    if (prev === undefined) break;
    const k = x - y;
    const prevWidth = d - 1;
    const downX = k + 1 >= -prevWidth && k + 1 <= prevWidth ? (prev[k + 1 + prevWidth] ?? -1) : -1;
    const rightX = k - 1 >= -prevWidth && k - 1 <= prevWidth ? (prev[k - 1 + prevWidth] ?? -1) : -1;
    const prevK = k === -d || (k !== d && rightX < downX) ? k + 1 : k - 1;
    const prevX = prev[prevK + prevWidth] ?? -1;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push({ kind: 'equal', a: x - 1, b: y - 1 });
      x--;
      y--;
    }
    if (x === prevX) {
      edits.push({ kind: 'insert', b: y - 1 });
      y--;
    } else {
      edits.push({ kind: 'delete', a: x - 1 });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    edits.push({ kind: 'equal', a: x - 1, b: y - 1 });
    x--;
    y--;
  }
  edits.reverse();
  return edits;
}

interface Hunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: string[];
}

interface DiffRow {
  prefix: ' ' | '-' | '+';
  aLine: number;
  bLine: number;
  text: string;
}

function buildHunks(a: string[], b: string[], edits: LineEdit[], context: number): Hunk[] {
  const rows: DiffRow[] = [];
  let aLine = 1;
  let bLine = 1;
  for (const edit of edits) {
    if (edit.kind === 'equal') {
      rows.push({ prefix: ' ', aLine, bLine, text: a[edit.a] ?? '' });
      aLine++;
      bLine++;
    } else if (edit.kind === 'delete') {
      rows.push({ prefix: '-', aLine, bLine, text: a[edit.a] ?? '' });
      aLine++;
    } else {
      rows.push({ prefix: '+', aLine, bLine, text: b[edit.b] ?? '' });
      bLine++;
    }
  }

  const changedAt = rows
    .map((row, idx) => (row.prefix === ' ' ? -1 : idx))
    .filter((idx) => idx !== -1);

  const hunks: Hunk[] = [];
  let cluster: number[] = [];
  for (const idx of changedAt) {
    const prev = cluster[cluster.length - 1];
    if (prev !== undefined && idx - prev > context * 2 + 1) {
      hunks.push(toHunk(rows, cluster, context));
      cluster = [];
    }
    cluster.push(idx);
  }
  if (cluster.length > 0) hunks.push(toHunk(rows, cluster, context));
  return hunks;
}

function toHunk(rows: DiffRow[], cluster: number[], context: number): Hunk {
  const first = cluster[0] ?? 0;
  const last = cluster[cluster.length - 1] ?? 0;
  const start = Math.max(0, first - context);
  const end = Math.min(rows.length - 1, last + context);
  const slice = rows.slice(start, end + 1);
  const firstRow = slice[0];
  let aStart = firstRow?.aLine ?? 1;
  let bStart = firstRow?.bLine ?? 1;
  let aCount = 0;
  let bCount = 0;
  const lines = slice.map((row) => {
    if (row.prefix !== '+') aCount++;
    if (row.prefix !== '-') bCount++;
    return `${row.prefix}${row.text}`;
  });
  if (slice.length === 0) {
    aStart = 1;
    bStart = 1;
  }
  return { aStart, aCount, bStart, bCount, lines };
}

/**
 * Unified diff of two file contents (1-indexed `@@ -a,b +c,d @@` hunks).
 * Pure: depends only on its arguments, no storage or validation.
 */
export function unifiedDiff(
  before: string,
  after: string,
  opts: UnifiedDiffOptions = {},
): UnifiedDiffResult {
  const context = opts.context ?? DEFAULT_CONTEXT;
  const maxInputLines = opts.maxInputLines ?? DEFAULT_MAX_INPUT_LINES;
  const maxDelta = opts.maxDelta ?? DEFAULT_MAX_DELTA;
  const maxOutputLines = opts.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;

  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > maxInputLines || b.length > maxInputLines) {
    return { diff: '', truncated: true };
  }

  const edits = myers(a, b, maxDelta);
  if (edits === undefined) {
    return { diff: '', truncated: true };
  }
  if (!edits.some((e) => e.kind !== 'equal')) {
    return { diff: '', truncated: false };
  }

  const hunks = buildHunks(a, b, edits, Math.max(0, context));
  const out: string[] = [];
  let truncated = false;
  for (const hunk of hunks) {
    const header = `@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`;
    if (out.length + 1 + hunk.lines.length > maxOutputLines) {
      const room = maxOutputLines - out.length - 2;
      out.push(header);
      if (room > 0) out.push(...hunk.lines.slice(0, room));
      out.push('... (diff truncated)');
      truncated = true;
      break;
    }
    out.push(header);
    out.push(...hunk.lines);
  }
  return { diff: out.join('\n'), truncated };
}
