/**
 * Formats per-chunk stream errors (notably tool input validation failures)
 * for the model. A validation failure only echoes the model's own input
 * plus schema info, so field-level detail is safe AND it stops the model
 * from hallucinating causes (e.g. blaming `include` when the real problem
 * is a missing `pattern`).
 *
 * Everything that is NOT recognizably an input validation error keeps its
 * message text (truncated). This text has two downstream consumers and both
 * need the signal:
 * - `tool-output-error` chunks are read by the model, so a backend tool
 *   failure stays actionable instead of a dead-end "An error occurred.".
 * - `error` chunks are re-mapped for the user by `mapAiError` (outer
 *   `onError` -> `oops`/`run-close`). Redacting here would destroy the
 *   provider/network signal and the user banner would show a generic
 *   INTERNAL_ERROR instead of e.g. PROVIDER_UNAVAILABLE.
 * Only errors with no message at all fall back to the generic redaction.
 */

const GENERIC = 'An error occurred.';

interface ValidationIssue {
  path?: unknown;
  message?: unknown;
}

function asIssueList(value: unknown): ValidationIssue[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const issues = (value as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues as ValidationIssue[];
}

/** Dig through InvalidToolInputError/TypeValidationError/ZodError wrappers. */
function findIssues(error: unknown, depth = 0): ValidationIssue[] | null {
  if (depth > 3 || typeof error !== 'object' || error === null) return null;
  const direct = asIssueList(error);
  if (direct) return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) return findIssues(cause, depth + 1);
  return null;
}

function toolNameOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { toolName?: unknown }).toolName;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * Non-validation errors keep their message (truncated) so downstream
 * consumers (model tool-output, user-facing `mapAiError`) still see the
 * provider/network signal. Generic redaction only when no message exists.
 */
function passThroughMessage(error: unknown): string {
  if (typeof error === 'string') {
    const text = error.trim().slice(0, 300);
    return text !== '' ? text : GENERIC;
  }
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      const text = message.trim().slice(0, 300);
      if (text !== '') return text;
    }
  }
  return GENERIC;
}

function isValidationLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const rec = error as { name?: unknown; message?: unknown };
  if (rec.name === 'AI_InvalidToolInputError' || rec.name === 'TypeValidationError') return true;
  if (typeof rec.message === 'string') {
    if (/^invalid input for tool /i.test(rec.message)) return true;
    if (rec.name === 'ZodError') return true;
  }
  return findIssues(error) !== null;
}

export function formatToolChunkError(error: unknown): string {
  if (!isValidationLike(error)) return passThroughMessage(error);
  const issues = findIssues(error) ?? [];
  const tool = toolNameOf(error);
  const head = tool ? `Invalid input for \`${tool}\`` : 'Invalid tool input';
  if (issues.length === 0) {
    const message =
      typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message?: unknown }).message).slice(0, 300)
        : 'invalid value';
    return `${head} — ${message}.`;
  }
  const bits = issues.slice(0, 5).map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
    const message = typeof issue.message === 'string' ? issue.message : 'invalid value';
    return path ? `\`${path}\`: ${message}` : message;
  });
  return `${head} — ${bits.join('; ')}.`;
}
