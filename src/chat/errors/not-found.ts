import { ChatDomainError } from './base.js';

export class ChatNotFoundError extends ChatDomainError {
  constructor(id: string, details?: unknown) {
    super('CHAT_NOT_FOUND', `Chat not found: ${id}`, details ?? { id }, 404);
  }
}
