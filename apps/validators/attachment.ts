import { z } from 'zod';
import {
  ALLOWED_IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MESSAGE,
  ATTACHMENT_URL_SCHEME,
} from '../../src/attachments/index.js';

export const AttachmentWorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export const AttachmentParamsSchema = AttachmentWorkspaceParamsSchema.extend({
  attachmentId: z.string().min(1),
});

const BASE64_SHAPE = /^[A-Za-z0-9+/=\s]*$/;

function decodedByteLength(dataBase64: string): number {
  const compact = dataBase64.replace(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.floor((compact.length * 3) / 4) - padding;
}

export const UploadAttachmentBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mediaType: z.enum(ALLOWED_IMAGE_MEDIA_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .refine((s) => BASE64_SHAPE.test(s), { message: 'dataBase64 must be valid base64' })
    .refine((s) => decodedByteLength(s) <= MAX_ATTACHMENT_BYTES, {
      message: `decoded file exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
    }),
});

export function validateUploadAttachment(body: unknown) {
  return UploadAttachmentBodySchema.parse(body);
}

export function validateAttachmentWorkspace(params: unknown) {
  return AttachmentWorkspaceParamsSchema.parse(params);
}

export function validateAttachmentParams(params: unknown) {
  return AttachmentParamsSchema.parse(params);
}

const ATTACHMENT_REF_PATTERN = /^attachment:\/\/[0-9a-fA-F-]{36}$/;

function dataUrlByteLength(url: string): number | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  return decodedByteLength(url.slice(comma + 1));
}

export interface FilePartIssue {
  message: string;
  /** Relative to the validated message object (e.g. ['parts', 0, 'url']). */
  path: (string | number)[];
}

/**
 * File-part rules for incoming user messages (image-only, phase 1).
 * Accepted url shapes: `attachment://<uuid>` (backend disk store) or
 * `data:image/...;base64,...` (small inline payloads, e.g. STDIO/Wails).
 * Pure: returns issues instead of throwing, so both Zod refinements and
 * plain unit tests can consume it.
 */
export function findFilePartIssues(parts: unknown[]): FilePartIssue[] {
  const issues: FilePartIssue[] = [];
  const files = parts.filter(
    (p): p is { type: 'file'; mediaType?: unknown; url?: unknown; filename?: unknown } =>
      typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'file',
  );
  if (files.length > MAX_FILES_PER_MESSAGE) {
    issues.push({
      message: `at most ${MAX_FILES_PER_MESSAGE} image attachments per message`,
      path: ['parts'],
    });
  }
  files.forEach((file, index) => {
    const path: (string | number)[] = ['parts', index];
    if (
      typeof file.mediaType !== 'string' ||
      !ALLOWED_IMAGE_MEDIA_TYPES.includes(
        file.mediaType as (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number],
      )
    ) {
      issues.push({
        message: `mediaType must be one of ${ALLOWED_IMAGE_MEDIA_TYPES.join(', ')}`,
        path: [...path, 'mediaType'],
      });
    }
    if (typeof file.url !== 'string') {
      issues.push({
        message: 'file url must be an attachment:// reference or image data-URL',
        path: [...path, 'url'],
      });
      return;
    }
    if (file.url.startsWith(ATTACHMENT_URL_SCHEME)) {
      if (!ATTACHMENT_REF_PATTERN.test(file.url)) {
        issues.push({
          message: 'attachment url must look like attachment://<uuid>',
          path: [...path, 'url'],
        });
      }
      return;
    }
    if (file.url.startsWith('data:image/')) {
      const size = dataUrlByteLength(file.url);
      if (size == null || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
        issues.push({
          message: `inline image exceeds ${MAX_ATTACHMENT_BYTES} bytes — upload via attachments first`,
          path: [...path, 'url'],
        });
      }
      return;
    }
    issues.push({
      message: 'file url must be an attachment:// reference or image data-URL',
      path: [...path, 'url'],
    });
  });
  return issues;
}

export function assertValidFileParts(parts: unknown[]): void {
  const found = findFilePartIssues(parts);
  if (found.length === 0) return;
  throw new z.ZodError(
    found.map((f) => ({
      code: 'custom' as const,
      message: f.message,
      path: f.path,
      input: parts,
    })),
  );
}
