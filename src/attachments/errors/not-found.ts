import { AttachmentsDomainError } from './base.js';

export class AttachmentNotFoundError extends AttachmentsDomainError {
  constructor(attachmentId: string) {
    super('NOT_FOUND', `Attachment ${attachmentId} not found`, { attachmentId }, 404);
  }
}

export class AttachmentForbiddenError extends AttachmentsDomainError {
  constructor(attachmentId: string, workspaceId: string) {
    super('FORBIDDEN', `Attachment ${attachmentId} does not belong to workspace ${workspaceId}`, {
      attachmentId,
      workspaceId,
    }, 403);
  }
}
