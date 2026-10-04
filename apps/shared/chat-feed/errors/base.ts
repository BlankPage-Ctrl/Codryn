export const CHAT_FEED_ERROR_STATUS_MAP = {
  ENCODE_FAILED: 500,
  MAP_FAILED: 500,
  INTERNAL_ERROR: 500,
} as const;

export type ChatFeedErrorCode = keyof typeof CHAT_FEED_ERROR_STATUS_MAP;

export abstract class ChatFeedDomainError extends Error {
  public readonly code: ChatFeedErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ChatFeedErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? CHAT_FEED_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class FeedEncodeError extends ChatFeedDomainError {
  constructor(message: string, details?: unknown) {
    super('ENCODE_FAILED', message, details);
  }
}
