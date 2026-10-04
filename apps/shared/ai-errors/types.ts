export interface MappedAiError {
  /** Stable machine code (ApiErrorCode value or run-feed code). */
  code: string;
  /** User-facing English message. Never contains secrets or chat content. */
  message: string;
  /** Whether retrying later may succeed. */
  retryable: boolean;
  /** HTTP semantics for the failure. */
  status: number;
}

export interface MapAiErrorOptions {
  /** Included in the last-resort message so the user can find the log. */
  chatId?: string;
}

export function fail(
  code: string,
  message: string,
  status: number,
  retryable = false,
): MappedAiError {
  return { code, message, status, retryable };
}
