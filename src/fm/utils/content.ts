export interface ContentLine {
  line: number;
  text: string;
}

const CAT_N_WIDTH = 6;

/** Detect the dominant line ending so paginated windows can preserve it. */
export function detectLineEnding(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** Normalize CRLF/CR to LF for matching, display, and line counting. */
export function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function splitToRawLines(content: string): string[] {
  if (content === '') return [];
  // Split on LF then strip a single trailing CR per line so CRLF files
  // behave like LF files for numbering, slicing, and previews.
  const raw = content.split('\n').map(stripCarriageReturn);
  // cat -n does not add an extra empty line for trailing newline.
  // "a\n" -> ["a",""] should be ["a"]; "a\n\n" -> ["a","",""] -> ["a",""]
  if (content.endsWith('\n') && raw[raw.length - 1] === '') {
    raw.pop();
  }
  return raw;
}

/**
 * Parse raw content into structured lines.
 * 1-indexed.
 */
export function parseContentToLines(content: string): ContentLine[] {
  const raw = splitToRawLines(content);
  return raw.map((text, idx) => ({ line: idx + 1, text }));
}

/**
 * Format lines like `cat -n` native: width 6 + tab + text.
 * e.g. "     1\timport x"
 */
export function formatWithLineNumbers(
  content: string,
  opts?: { startLine?: number; endLine?: number },
): string {
  const lines = parseContentToLines(content);
  const sliced = sliceLinesByRange(lines, opts?.startLine, opts?.endLine);
  return sliced
    .map(({ line, text }) => `${String(line).padStart(CAT_N_WIDTH)}\t${text}`)
    .join('\n');
}

/**
 * Slice already-parsed lines by 1-indexed range (inclusive).
 */
export function sliceLinesByRange(
  lines: ContentLine[],
  startLine?: number,
  endLine?: number,
): ContentLine[] {
  const start = startLine != null && startLine > 0 ? startLine : 1;
  const end = endLine != null && endLine > 0 ? endLine : lines.length;
  if (start > lines.length) return [];
  return lines.filter((l) => l.line >= start && l.line <= end);
}

/**
 * Parse a `cat -n` formatted string back to structured lines.
 * Supports both native `cat -n` (`     1\ttext`) and pipe style (`    1 | text`).
 */
export function parseLineNumberedContent(contentWithLineNumbers: string): ContentLine[] {
  if (contentWithLineNumbers === '') return [];
  const rawLines = contentWithLineNumbers.split('\n');
  const out: ContentLine[] = [];
  // native: /^\s*(\d+)\t(.*)$/
  // pipe fallback: /^\s*(\d+)\s*\|\s*(.*)$/
  const nativeRe = /^\s*(\d+)\t(.*)$/;
  const pipeRe = /^\s*(\d+)\s*\|\s*(.*)$/;

  for (const rawLine of rawLines) {
    const raw = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (raw === '') {
      // cat -n never emits truly empty line, but if it does, skip
      continue;
    }
    let m = raw.match(nativeRe);
    if (!m) m = raw.match(pipeRe);
    if (m) {
      out.push({ line: Number(m[1]), text: m[2] });
    } else {
      // fallback: treat as line without number (should not happen)
      out.push({ line: out.length + 1, text: raw });
    }
  }
  return out;
}

export interface LineNumberedResult {
  contentWithLineNumbers: string;
  totalLines: number;
}

/**
 * Build the full line-numbered result from raw content.
 * Handles startLine/endLine pagination (1-indexed inclusive).
 * Use parseContentToLines / parseLineNumberedContent to derive structured lines if needed.
 */
export function toLineNumberedResult(
  content: string,
  opts?: { startLine?: number; endLine?: number },
): LineNumberedResult {
  const allLines = parseContentToLines(content);
  const totalLines = allLines.length;
  if (totalLines === 0) {
    return { contentWithLineNumbers: '', totalLines: 0 };
  }
  const sliced = sliceLinesByRange(allLines, opts?.startLine, opts?.endLine);
  const contentWithLineNumbers = sliced
    .map(({ line, text }) => `${String(line).padStart(CAT_N_WIDTH)}\t${text}`)
    .join('\n');
  return { contentWithLineNumbers, totalLines };
}
