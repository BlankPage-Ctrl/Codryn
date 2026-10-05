import stripAnsi from 'strip-ansi';

export interface TruncatedOutput {
  text: string;
  truncated: boolean;
  spillPath: string | null;
}

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
  _maxChars: number,
  _options?: { spill?: boolean },
): TruncatedOutput {
  void _maxChars;
  void _options;
  return { text, truncated: false, spillPath: null };
}
