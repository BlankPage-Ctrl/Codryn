import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_MAX_CHARS = 8_000;
export const DEFAULT_MAX_LINES = 100;
export const TRUNCATED_DIR_REL = '.codryn/truncated' as const;

const SIMPLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
export type TruncateMode = 'head' | 'tail' | 'head-tail';

export interface TruncateToolOutputOptions {
  content: string;
  projectPath: string;
  /** Max characters for visible output. If undefined, char limit is disabled. */
  maxChars?: number;
  /** Max lines for visible output (1-indexed line count). If undefined, line limit is disabled. */
  maxLines?: number;
  toolName?: string;
  toolCallId?: string;
  mode?: TruncateMode;
  /** Ratio of head budget for 'head-tail' mode: 0..1 . Default 0.25 (head 25% tail 75%). */
  headRatio?: number;
  writer?: {
    createFile: (
      relPath: string,
      content: string,
    ) => Promise<{ success: boolean; error?: unknown }>;
  };
}

export interface TruncateToolOutputResult {
  /** Text to send to the LM, notice if truncated, otherwise original). */
  text: string;
  truncated: boolean;
  /** Relative spill path like ".codryn/truncated/run_shell-abcde.txt" when truncated, else null. */
  spillPath: string | null;
  /** Absolute spill path when truncated, else null. */
  spillAbsPath: string | null;
  originalLength: number;
  originalLines: number;
  /** Number of chars/lines omitted from the AI view. */
  omittedChars: number;
  omittedLines: number;
}

interface BuildVisibleInput {
  maxChars: number | null;
  maxLines: number | null;
  originalLength: number;
  originalLines: number;
  mode: TruncateMode;
  headRatio: number;
}

interface BuildVisibleResult {
  visible: string;
  keptChars: number;
  keptLines: number;
  // for head-tail, head/tail segment stats
  headChars?: number;
  tailChars?: number;
  headLines?: number;
  tailLines?: number;
  omittedMiddle?: { chars: number; lines: number };
}

function countLines(content: string): number {
  if (content === '') return 0;
  // Consistent with splitToRawLines semantics: trailing newline does not create extra empty line.
  const raw = content.split('\n');
  if (content.endsWith('\n') && raw[raw.length - 1] === '') raw.pop();
  return raw.length;
}

function splitIntoLines(content: string): string[] {
  if (content === '') return [];
  const raw = content.split('\n');
  if (content.endsWith('\n') && raw[raw.length - 1] === '') raw.pop();
  return raw;
}

function randomSimpleId(len = 5): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[i] ?? 0;
    out += SIMPLE_ALPHABET[b % SIMPLE_ALPHABET.length]!;
  }
  return out;
}

function sanitizeToolName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 32) : 'tool';
}

async function writeSpillFile(
  projectPath: string,
  relPath: string,
  content: string,
  writer?: TruncateToolOutputOptions['writer'],
): Promise<void> {
  if (writer) {
    const res = await writer.createFile(relPath, content);
    if (!res.success) throw new Error(`writer.createFile failed for ${relPath}`);
    return;
  }
  const abs = path.resolve(projectPath, relPath);
  // Safety: ensure abs is inside projectPath
  const root = path.resolve(projectPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Spill path escapes project root: ${relPath}`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

async function uniqueSpillRel(
  projectPath: string,
  toolName: string,
  writer?: TruncateToolOutputOptions['writer'],
): Promise<string> {
  const safe = sanitizeToolName(toolName);
  // Try up to 10 times to avoid collision on 5-char ID
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = randomSimpleId(5);
    const rel = path.posix.join(TRUNCATED_DIR_REL, `${safe}-${id}.txt`);
    const abs = path.resolve(projectPath, rel);
    try {
      await fs.access(abs);
      // exists -> try next id
      continue;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return rel;
      // If writer is used,  can't check fs; just return (writer will handle overwrite guard)
      if (writer) return rel;
      // Unexpected error -> still try to return this rel (write will surface error)
      return rel;
    }
  }
  // Fallback? use longer id
  const id = randomSimpleId(8);
  return path.posix.join(TRUNCATED_DIR_REL, `${sanitizeToolName(toolName)}-${id}.txt`);
}

function normalizeLimits(
  maxChars?: number,
  maxLines?: number,
): { chars: number | null; lines: number | null } {
  const chars =
    maxChars != null && Number.isFinite(maxChars) && maxChars > 0 ? Math.trunc(maxChars) : null;
  const lines =
    maxLines != null && Number.isFinite(maxLines) && maxLines > 0 ? Math.trunc(maxLines) : null;
  return { chars, lines };
}

function normalizeMode(mode?: TruncateMode): TruncateMode {
  if (mode === 'tail' || mode === 'head-tail') return mode;
  return 'head';
}

function normalizeHeadRatio(ratio?: number): number {
  if (ratio == null || !Number.isFinite(ratio)) return 0.25;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

export async function truncateToolOutput(
  opts: TruncateToolOutputOptions,
): Promise<TruncateToolOutputResult> {
  const content = opts.content ?? '';
  const projectPath = path.resolve(opts.projectPath);
  const toolName = opts.toolName ?? 'tool';
  const mode = normalizeMode(opts.mode);
  const headRatio = normalizeHeadRatio(opts.headRatio);

  const { chars: maxChars, lines: maxLines } = normalizeLimits(
    opts.maxChars ?? DEFAULT_MAX_CHARS,
    opts.maxLines ?? DEFAULT_MAX_LINES,
  );

  const originalLength = content.length;
  const originalLines = countLines(content);

  const needsByChars = maxChars != null && originalLength > maxChars;
  const needsByLines = maxLines != null && originalLines > maxLines;
  const needsTruncate = needsByChars || needsByLines;

  if (!needsTruncate) {
    return {
      text: content,
      truncated: false,
      spillPath: null,
      spillAbsPath: null,
      originalLength,
      originalLines,
      omittedChars: 0,
      omittedLines: 0,
    };
  }

  // Compute visible portion based on mode
  const built = buildVisible(content, {
    maxChars,
    maxLines,
    originalLength,
    originalLines,
    mode,
    headRatio,
  });
  const visible = built.visible;
  const omittedChars = originalLength - built.keptChars;
  const omittedLines = originalLines - built.keptLines;

  // Spill full original content
  const spillRel = await uniqueSpillRel(projectPath, toolName, opts.writer);
  await writeSpillFile(projectPath, spillRel, content, opts.writer);
  const spillAbs = path.resolve(projectPath, spillRel);

  const text = buildFinalText(visible, built, {
    originalLength,
    originalLines,
    spillRel,
    maxLines,
    needsByLines,
    mode,
    headLines: built.headLines,
    content,
  });

  return {
    text,
    truncated: true,
    spillPath: spillRel,
    spillAbsPath: spillAbs,
    originalLength,
    originalLines,
    omittedChars: Math.max(0, omittedChars),
    omittedLines: Math.max(0, omittedLines),
  };
}

function buildVisible(content: string, input: BuildVisibleInput): BuildVisibleResult {
  const { maxChars, maxLines, mode, headRatio, originalLines } = input;

  if (mode === 'tail') {
    return buildTailVisible(content, maxChars, maxLines);
  }
  if (mode === 'head-tail') {
    return buildHeadTailVisible(content, maxChars, maxLines, headRatio, originalLines);
  }
  return buildHeadVisible(content, maxChars, maxLines);
}

function buildHeadVisible(
  content: string,
  maxChars: number | null,
  maxLines: number | null,
): BuildVisibleResult {
  let visible = content;
  if (maxLines != null && countLines(content) > maxLines) {
    const lines = splitIntoLines(content);
    visible = lines.slice(0, maxLines).join('\n');
  }
  if (maxChars != null && visible.length > maxChars) {
    visible = visible.slice(0, maxChars);
  }
  return {
    visible,
    keptChars: visible.length,
    keptLines: countLines(visible),
  };
}

function buildTailVisible(
  content: string,
  maxChars: number | null,
  maxLines: number | null,
): BuildVisibleResult {
  let visible = content;
  if (maxLines != null && countLines(content) > maxLines) {
    const lines = splitIntoLines(content);
    visible = lines.slice(-maxLines).join('\n');
  }
  if (maxChars != null && visible.length > maxChars) {
    visible = visible.slice(-maxChars);
  }
  return {
    visible,
    keptChars: visible.length,
    keptLines: countLines(visible),
  };
}

function buildHeadTailVisible(
  content: string,
  maxChars: number | null,
  maxLines: number | null,
  headRatio: number,
  originalLines: number,
): BuildVisibleResult {
  const lines = splitIntoLines(content);
  let head = '';
  let tail = '';
  let headLines = 0;
  let tailLines = 0;

  // Lines budget split
  if (maxLines != null && originalLines > maxLines) {
    headLines = Math.floor(maxLines * headRatio);
    tailLines = maxLines - headLines;
    // Ensure at least 1 line each when possible
    if (maxLines >= 2) {
      if (headLines < 1) headLines = 1;
      if (tailLines < 1) tailLines = 1;
      // re-balance if rounding exceeded
      if (headLines + tailLines > maxLines) {
        tailLines = maxLines - headLines;
      }
    }
    head = lines.slice(0, headLines).join('\n');
    tail = lines.slice(-tailLines).join('\n');
  } else if (maxLines != null) {
    // Not truncated by lines, but head-tail by chars will still split chars
    headLines = originalLines;
  }

  // Chars budget split
  if (maxChars != null) {
    if (head !== '' || tail !== '') {
      // Already split by lines - enforce char budgets on each part
      const headCharsBudget = Math.floor(maxChars * headRatio);
      const tailCharsBudget = maxChars - headCharsBudget;
      if (head.length > headCharsBudget) head = head.slice(0, headCharsBudget);
      if (tail.length > tailCharsBudget) tail = tail.slice(-tailCharsBudget);
      // Recompute line counts after char trimming
      headLines = head ? countLines(head) : headLines;
      tailLines = tail ? countLines(tail) : tailLines;
    } else if (content.length > maxChars) {
      const headCharsBudget = Math.floor(maxChars * headRatio);
      const tailCharsBudget = maxChars - headCharsBudget;
      head = content.slice(0, headCharsBudget);
      tail = content.slice(-tailCharsBudget);
      headLines = countLines(head);
      tailLines = countLines(tail);
    } else {
      // Not truncated by chars either (should not happen as needsTruncate true, but handle)
      head = content;
      tail = '';
    }
  } else if (head === '' && tail === '') {
    // Only lines truncated and haven't built head/tail? Already handled above.
    // If only lines truncated but maxChars null, head/tail already set.
    // If neither lines nor chars split created head/tail (e.g., only chars truncated case handled), fallback to head/tail already.
  }

  // If only truncated by one dimension but head-tail requires both parts,
  // ensure its have both head and tail even when only one dimension triggered.
  if (head === '' && tail === '') {
    // Should not happen - fallback to head
    return buildHeadVisible(content, maxChars, maxLines);
  }
  if (head !== '' && tail === '' && maxChars != null && content.length > maxChars) {
    // Had line split but char split not applied because content was not > maxChars by lines?
    // Already handled.
  }

  // If built head/tail via lines but maxChars was null, that's fine.
  // If built via chars but maxLines was active but not exceeded, head already contains full content? Need to ensure tail present.
  if (head !== '' && tail === '' && maxChars != null) {
    // are in chars-only head-tail
    // head and tail already set
  }

  const kept = head.length + tail.length;
  const keptLinesRaw = countLines(head) + countLines(tail);
  // Single-line content split into head+tail both count as 1 line each - clamp to original line count
  const keptLinesCount = Math.min(originalLines, keptLinesRaw);
  const omittedChars = content.length - kept;
  const omittedLines = Math.max(0, originalLines - keptLinesCount);

  // Build visible with middle marker
  let visible: string;
  if (head !== '' && tail !== '') {
    const safeOmittedChars = Math.max(0, omittedChars);
    const safeOmittedLines = Math.max(0, omittedLines);
    const omitNotice = `<truncate-omit>${safeOmittedChars.toLocaleString()} chars / ${safeOmittedLines} lines omitted (middle truncated, head ${headLines || countLines(head)} lines / tail ${tailLines || countLines(tail)} lines kept)</truncate-omit>`;
    visible = `${head}\n\n${omitNotice}\n\n${tail}`;
  } else if (head !== '') {
    visible = head;
  } else {
    visible = tail;
  }

  return {
    visible,
    keptChars: kept,
    keptLines: keptLinesCount,
    headChars: head.length,
    tailChars: tail.length,
    headLines: headLines || countLines(head),
    tailLines: tailLines || countLines(tail),
    omittedMiddle: { chars: Math.max(0, omittedChars), lines: Math.max(0, omittedLines) },
  };
}

function buildFinalText(
  visible: string,
  built: BuildVisibleResult,
  ctx: {
    originalLength: number;
    originalLines: number;
    spillRel: string;
    maxLines: number | null;
    needsByLines: boolean;
    mode: TruncateMode;
    headLines?: number;
    content: string;
  },
): string {
  const {
    originalLength,
    originalLines,
    spillRel,
    maxLines,
    needsByLines,
    mode,
    headLines,
    content,
  } = ctx;
  // For head-tail, visible already contains <truncate-omit> marker; still append final <truncate> notice
  let recommendStartLine: number;
  let isEstimated: boolean;

  if (mode === 'head-tail' && headLines != null) {
    recommendStartLine = headLines + 1;
    isEstimated = false;
  } else if (mode === 'tail') {
    // Tail keeps end, omitted head starts at line 1
    recommendStartLine = 1;
    isEstimated = false;
  } else {
    // head default
    recommendStartLine =
      maxLines != null && originalLines > maxLines
        ? maxLines + 1
        : estimateStartLineForCharTruncation(content, built.keptChars);
    isEstimated = maxLines == null || originalLines <= (maxLines ?? 0);
  }

  const lineHint = isEstimated
    ? `around line ${recommendStartLine} (estimated from character limit)`
    : `at line ${recommendStartLine}`;

  const notice = `<truncate> Output truncated - ${originalLength.toLocaleString()} chars / ${originalLines} lines total, showing ${built.keptChars.toLocaleString()} chars / ${built.keptLines} lines. If you need the full output, use \`read_file\` with a smaller window on the original target${needsByLines || mode !== 'head' ? `, continuing ${lineHint}` : ''}). If the output has already answered your question, it is better not to read it again. Full output is also saved to \`${spillRel}\`</truncate>`;

  return `${visible}\n\n${notice}`;
}

function estimateStartLineForCharTruncation(content: string, visibleLen: number): number {
  let line = 1;
  for (let i = 0; i < visibleLen && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  /*If truncated mid-line, the next line is line+1; but i think i already counted newlines inside visible
    The remainder starts at line (if visible ends mid-line, same line) or line+1? just Simple: line
    Use line + (content[visibleLen-1] !== '\n' ? 0 : 0) - recommend line as next line after last full line
    Find last newline before visibleLen*/
  const lastNL = content.lastIndexOf('\n', visibleLen - 1);
  if (lastNL === -1) return 1; // visible is within first line -> start at 1 for char-only
  // If visible ends exactly at newline, next line is line
  // If visible ends mid-line, remainder is still same line - but read_file is line-based, so suggest next line
  const visibleEndsAtNL = content[visibleLen - 1] === '\n';
  if (visibleEndsAtNL) return line;
  // mid-line: count lines up to visibleLen inclusive would be line, but 'd have partial line
  // Recommend line (the line containing truncation point)
  return line;
}

/** Synchronous check without I/O. */
export function isTruncated(
  content: string,
  maxChars = DEFAULT_MAX_CHARS,
  maxLines = DEFAULT_MAX_LINES,
): boolean {
  const { chars, lines } = normalizeLimits(maxChars, maxLines);
  if (chars != null && content.length > chars) return true;
  if (lines != null && countLines(content) > lines) return true;
  return false;
}
