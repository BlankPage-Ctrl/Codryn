/**
 * Formats per-chunk stream errors (notably tool input validation failures)
 * for the model. The AI SDK redacts these to "An error occurred." by default
 * to avoid leaking server details - but a validation failure only echoes the
 * model's own input plus schema info, so field-level detail is safe AND it
 * stops the model from hallucinating causes (e.g. blaming `include` when
 * the real problem is a missing `pattern`).
 *
 * Everything that is NOT recognizably an input validation error keeps the
 * generic redaction (provider/stream errors may carry server details).
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
  if (!isValidationLike(error)) return GENERIC;
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
