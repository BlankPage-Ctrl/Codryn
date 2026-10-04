import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import stripAnsi from 'strip-ansi';

export interface TruncatedOutput {
  text: string;
  truncated: boolean;
  spillPath: string | null;
}

const HEAD_RATIO = 0.25;
const SPILL_PREFIX = 'codryn-shell-';

export function stripAnsiText(text: string): string {
  return stripAnsi(text);
}

/**
 * Strips ANSI only, no truncation.
 * Truncation and spill are now handled at the agent layer via
 * `truncateToolOutput` (`.codryn/truncated/*.txt`).
 */
export function formatCommandOutput(
  stdout: string,
  stderr: string,
  _maxChars?: number,
): TruncatedOutput {
  void _maxChars;
  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  const combined = [cleanStdout, cleanStderr].filter(Boolean).join('\n');
  const text = combined.trim().length === 0 ? '(no output)' : combined;
  return { text, truncated: false, spillPath: null };
}

/**
 * @deprecated shell no longer truncates internally. Use `truncateToolOutput`
 * from `apps/agent/utils/truncate.ts` for project-scoped spill to
 * `.codryn/truncated/`. This shim keeps existing call sites compiling.
 */
export function truncateText(
  text: string,
  maxChars: number,
  options?: { spill?: boolean },
): TruncatedOutput {
  if (text.length <= maxChars) {
    return { text, truncated: false, spillPath: null };
  }

  const spill = options?.spill !== false;
  const spillPath = spill ? spillToTemp(text) : null;
  const headBudget = Math.floor(maxChars * HEAD_RATIO);
  const tailBudget = maxChars - headBudget;
  const omitted = text.length - maxChars;
  const spillHint = spillPath ? `; full output at ${spillPath}` : '';
  const body =
    text.slice(0, headBudget) +
    `\n\n... (${omitted.toLocaleString()} of ${text.length.toLocaleString()} chars omitted${spillHint}) ...\n\n` +
    text.slice(-tailBudget);

  return { text: body, truncated: true, spillPath };
}

function spillToTemp(text: string): string {
  const file = join(tmpdir(), `${SPILL_PREFIX}${Date.now()}-${randomBytes(4).toString('hex')}.txt`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf-8');
  return file;
}
