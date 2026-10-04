import type { UIMessage } from 'ai';
import { ATTACHMENT_URL_SCHEME } from '../../src/attachments/index.js';

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
 * Rewrites `attachment://<id>` file urls to provider-ready data-URLs.
 * Pure: returns new message objects, never mutates the input (the persisted
 * copies keep the opaque refs so the DB stays lean).
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
