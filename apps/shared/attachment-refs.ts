import type { UIMessage } from 'ai';
import { ATTACHMENT_URL_SCHEME } from '../../src/attachments/index.js';
import type { AttachmentsService } from '../../src/attachments/index.js';
import { AttachmentsDomainError } from '../../src/attachments/errors/base.js';
import { AppError } from './errors.js';

export function attachmentIdFromUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_SCHEME)) return null;
  const id = url.slice(ATTACHMENT_URL_SCHEME.length);
  return id.length > 0 ? id : null;
}

function isFilePart(part: unknown): part is { type: 'file'; url?: unknown } {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'file';
}

/** Collects every `attachment://<id>` referenced by file parts. */
export function collectAttachmentIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isFilePart(part) || typeof part.url !== 'string') continue;
      const id = attachmentIdFromUrl(part.url);
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

/**
 * Rewrites attachment refs to data-URLs. Pure: never mutates the input.
 */
export function rewriteAttachmentUrls(
  messages: UIMessage[],
  dataUrls: Map<string, string>,
): UIMessage[] {
  return messages.map((message) => {
    let changed = false;
    const parts = (message.parts ?? []).map((part) => {
      if (!isFilePart(part) || typeof part.url !== 'string') return part;
      const id = attachmentIdFromUrl(part.url);
      if (!id) return part;
      const dataUrl = dataUrls.get(id);
      if (!dataUrl) return part;
      changed = true;
      return { ...part, url: dataUrl };
    });
    return changed ? { ...message, parts } : message;
  });
}

// Unknown or foreign attachments abort the run before any model call.
export function toAttachmentAppError(err: AttachmentsDomainError): AppError {
  const code =
    err.code === 'VALIDATION_FAILED' || err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN'
      ? err.code
      : 'INTERNAL_ERROR';
  return new AppError(err.statusCode, err.message, code);
}

export async function linkIncomingAttachments(
  attachments: Pick<AttachmentsService, 'markLinked'>,
  workspaceId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  try {
    await attachments.markLinked(workspaceId, attachmentIds);
  } catch (err) {
    if (err instanceof AttachmentsDomainError) throw toAttachmentAppError(err);
    throw err;
  }
}

// Persisted copies keep the opaque refs so the DB stays lean.
export async function resolveAttachmentsForModel(
  attachments: Pick<AttachmentsService, 'resolveDataUrls'>,
  uiMessages: UIMessage[],
  workspaceId: string,
): Promise<UIMessage[]> {
  const ids = collectAttachmentIds(uiMessages);
  if (ids.length === 0) return uiMessages;
  try {
    const dataUrls = await attachments.resolveDataUrls(workspaceId, ids);
    return rewriteAttachmentUrls(uiMessages, dataUrls);
  } catch (err) {
    if (err instanceof AttachmentsDomainError) throw toAttachmentAppError(err);
    throw err;
  }
}
