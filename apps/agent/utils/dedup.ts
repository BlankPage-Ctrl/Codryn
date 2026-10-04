const INFINITY_END = Number.POSITIVE_INFINITY;

interface ReadWindow {
  start: number;
  end: number;
  complete: boolean;
}

/**
 * Refuses a read_file window that adds zero new information: the range is
 * already fully covered by earlier COMPLETE reads of the same path.
 * Continuations (new ground) and re-reads after a truncated result pass.
 * Truncated prior reads never protect, so paginating a remainder works.
 */
export function createReadSubsetGuard() {
  const byPath = new Map<string, ReadWindow[]>();

  function isCovered(windows: ReadWindow[], start: number, end: number): boolean {
    let cursor = start;
    const sorted = [...windows].filter((w) => w.complete).sort((a, b) => a.start - b.start);
    for (const w of sorted) {
      if (w.start > cursor) return false;
      if (w.end >= cursor) cursor = Math.min(w.end + 1, INFINITY_END);
      if (cursor > end) return true;
    }
    return cursor > end;
  }

  return {
    check(path: string, start: number, end?: number): string | null {
      if (isSpillPath(path)) {
        return (
          '**Error**: `SPILL_FILE` — Do not read files under `.codryn/truncated/`; ' +
          'that is leftover tool output already shown in context. Narrow the original query instead.'
        );
      }
      const targetEnd = end ?? INFINITY_END;
      const windows = byPath.get(path);
      if (windows && isCovered(windows, start, targetEnd)) {
        return (
          `**Error**: \`ALREADY_READ\` — \`${path}\` lines ${start}–${end ?? 'end'} ` +
          'are already in context from an earlier read. Answer from context; ' +
          'only re-read if the file changed or the earlier read was truncated or missed.'
        );
      }
      return null;
    },
    record(path: string, start: number, end: number | undefined, complete: boolean): void {
      const list = byPath.get(path) ?? [];
      list.push({ start, end: end ?? INFINITY_END, complete });
      byPath.set(path, list);
    },
  };
}

export type ReadSubsetGuard = ReturnType<typeof createReadSubsetGuard>;

function isSpillPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === '.codryn/truncated' || normalized.startsWith('.codryn/truncated/');
}

/**
 * Refuses N identical consecutive calls (same JSON input) with an error
 * telling the model to proceed from context instead of retrying.
 */
export function createRepeatGuard(limit = 3) {
  const recent: string[] = [];

  return {
    check(inputJson: string, toolName: string): string | null {
      recent.push(inputJson);
      if (recent.length > limit) recent.shift();
      if (recent.length === limit && recent.every((v) => v === inputJson)) {
        recent.length = 0;
        return (
          `**Error**: \`REPEAT_CALL\` — \`${toolName}\` was just called ${limit}x ` +
          'with identical input. Do not retry; answer from the context you already have.'
        );
      }
      return null;
    },
  };
}

export type RepeatGuard = ReturnType<typeof createRepeatGuard>;
