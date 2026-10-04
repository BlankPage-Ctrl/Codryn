export interface Want {
  /** 1-indexed inclusive. */
  start: number;
  end: number;
  /** Trail step 10, anchor 9, edge site 2. */
  weight: number;
}

interface Cluster {
  start: number;
  end: number;
  weight: number;
}

const PADDING = 3;
const MIN_CHARS = 700;
const WHOLE_MAX_LINES = 220;
const WHOLE_SPINE_LINES = 280;
const GRACE_FRACTION = 0.15;
const GRACE_MAX = 800;
const BUY_FRACTION = 0.6;

function langOf(path: string): string {
  if (path.endsWith('.py') || path.endsWith('.pyi')) return 'python';
  return 'typescript';
}

function elideMarker(path: string, n: number): string {
  const c = langOf(path) === 'python' ? '#' : '//';
  return `${c} … ${n} line${n === 1 ? '' : 's'} elided …`;
}

const CAT_N_WIDTH = 6;

/** Number lines exactly like `read_file` (`cat -n`: width 6 + tab). */
export function numberLines(lines: string[], first: number): string {
  return lines.map((l, i) => `${String(first + i).padStart(CAT_N_WIDTH)}\t${l}`).join('\n');
}

function numbered(lines: string[], first: number): string {
  return numberLines(lines, first);
}

/** Merge wants into padded clusters, ranked spine-weight first. */
export function buildClusters(wants: Want[], lineCount: number, gap: number): Cluster[] {
  const ranges = wants
    .map((w) => ({
      start: Math.max(1, w.start - PADDING),
      end: Math.min(lineCount, w.end + PADDING),
      weight: w.weight,
    }))
    .sort((a, b) => a.start - b.start);
  const merged: Cluster[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end);
      last.weight = Math.max(last.weight, r.weight);
    } else {
      merged.push({ ...r });
    }
  }
  // Rank: hottest cluster first, then densest, then earliest.
  merged.sort(
    (a, b) => b.weight - a.weight || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  return merged;
}

export interface Slice {
  text: string;
  spent: number;
  whole: boolean;
  trimmed: boolean;
}

/**
 * Slice one file into its allowance. Whole when small or already bought;
 * otherwise top clusters until the remainder cannot hold a useful slice.
 *
 * `lines` are RAW source lines (no numbers); numbering is applied here so
 * output is byte-identical to read_file (`cat -n`).
 */
export function sliceFile(
  path: string,
  lines: string[],
  wants: Want[],
  allowance: number,
  gap: number,
  spine: boolean,
): Slice {
  const maxLines = spine ? WHOLE_SPINE_LINES : WHOLE_MAX_LINES;
  const body = numbered(lines, 1);
  const grace = allowance + Math.min(GRACE_MAX, allowance * GRACE_FRACTION);
  if (lines.length <= maxLines && body.length <= grace) {
    return { text: body, spent: body.length, whole: true, trimmed: false };
  }
  if (body.length * BUY_FRACTION <= allowance && body.length <= grace) {
    return { text: body, spent: body.length, whole: true, trimmed: false };
  }

  const clusters = buildClusters(wants, lines.length, gap);
  if (clusters.length === 0) {
    const head = numbered(lines.slice(0, Math.min(lines.length, 40)), 1);
    return { text: head, spent: head.length, whole: false, trimmed: true };
  }
  // Select in rank order (first always renders), emit in source order so
  // elide markers always span a positive forward gap.
  const taken: Cluster[] = [];
  let room = allowance;
  let trimmed = false;
  clusters.forEach((c, i) => {
    const chunk = numbered(lines.slice(c.start - 1, c.end), c.start);
    if (i === 0) {
      if (chunk.length <= room) {
        taken.push(c);
        room -= chunk.length;
      } else {
        const fit = chunk.slice(0, room);
        const cut = fit.lastIndexOf('\n');
        const head = (cut > 0 ? fit.slice(0, cut) : fit) as string;
        taken.push({
          start: c.start,
          end: c.start + head.split('\n').length - 1,
          weight: c.weight,
        });
        room = 0;
        trimmed = true;
      }
      return;
    }
    if (room < MIN_CHARS) {
      trimmed = true;
      return;
    }
    if (chunk.length <= room) {
      taken.push(c);
      room -= chunk.length;
    } else {
      trimmed = true;
    }
  });
  taken.sort((a, b) => a.start - b.start);
  // Re-sliced from source, so a shrunk head stays line-exact.
  const parts = taken.map((c) => numbered(lines.slice(c.start - 1, c.end), c.start));
  const text = parts
    .map((p, i) => {
      if (i === 0) return p;
      const gapN = taken[i]!.start - taken[i - 1]!.end - 1;
      return `${elideMarker(path, Math.max(0, gapN))}\n${p}`;
    })
    .join('\n');
  // Spent is the honest final length: markers ride along, not free.
  return { text, spent: text.length, whole: false, trimmed };
}
