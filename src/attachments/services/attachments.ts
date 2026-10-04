import type {
  AttachmentMeta,
  AttachmentUploadInput,
  IAttachmentBytesStorage,
  NewAttachmentRow,
} from '../types/attachment.js';
import {
  ALLOWED_IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  PENDING_ATTACHMENT_TTL_MS,
} from '../types/attachment.js';
import { sniffImageMediaType } from '../engines/sniff.js';
import { sanitizeFilename } from '../utils/filename.js';
import { AttachmentsRepository } from '../repository/attachments.js';
import { ValidationError } from '../errors/validation.js';
import { AttachmentForbiddenError, AttachmentNotFoundError } from '../errors/not-found.js';

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export interface AttachmentSweepResult {
  scanned: number;
  deleted: number;
  failures: Array<{ id: string; error: string }>;
}

export class AttachmentsService {
  constructor(
    private readonly repo: AttachmentsRepository,
    private readonly bytes: IAttachmentBytesStorage,
  ) {}

  /**
   * Stores an uploaded image. Validates size, base64 shape, and magic bytes -
   * the claimed mediaType is never trusted. Returns metadata (never the bytes).
   */
  async upload(input: AttachmentUploadInput): Promise<AttachmentMeta> {
    if (!input.workspaceId) {
      throw new ValidationError('Invalid workspaceId for attachment upload', {});
    }
    const filename = input.filename.trim();
    if (!filename || filename.length > 255) {
      throw new ValidationError('Invalid filename for attachment upload', {});
    }
    if (!ALLOWED_IMAGE_MEDIA_TYPES.includes(input.mediaType as (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number])) {
      throw new ValidationError(`Unsupported media type: ${input.mediaType}`, {
        allowed: [...ALLOWED_IMAGE_MEDIA_TYPES],
      });
    }
    const compact = input.dataBase64.replace(/\s+/g, '');
    if (compact.length === 0 || !BASE64_PATTERN.test(compact)) {
      throw new ValidationError('Invalid base64 payload for attachment upload', {});
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(compact, 'base64');
    } catch {
      throw new ValidationError('Invalid base64 payload for attachment upload', {});
    }
    if (decoded.length === 0 || decoded.length > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError(
        `Attachment size ${decoded.length} bytes exceeds limit ${MAX_ATTACHMENT_BYTES}`,
        { sizeBytes: decoded.length },
      );
    }
    const sniffed = sniffImageMediaType(decoded);
    if (!sniffed) {
      throw new ValidationError('Upload is not a supported image (magic-byte check failed)', {});
    }
    if (sniffed !== input.mediaType) {
      throw new ValidationError(
        `Claimed media type ${input.mediaType} does not match file content (${sniffed})`,
        { claimed: input.mediaType, detected: sniffed },
      );
    }

    const id = crypto.randomUUID();
    // On-disk name keeps the id (for GC/debugging) plus the original name.
    // Expiry lives in the DB row (expiresAt), not in the filename.
    const storedFilename = `${id}__${sanitizeFilename(filename)}`;
    const now = new Date();
    const row: NewAttachmentRow = {
      id,
      workspaceId: input.workspaceId,
      originalFilename: filename,
      storedFilename,
      mediaType: sniffed,
      sizeBytes: decoded.length,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PENDING_ATTACHMENT_TTL_MS).toISOString(),
    };
    await this.bytes.write(input.workspaceId, storedFilename, decoded);
    try {
      return await this.repo.insert(row);
    } catch (err) {
      // Never leave orphan bytes when the meta write fails.
      await this.bytes.remove(input.workspaceId, storedFilename).catch(() => {});
      throw err;
    }
  }

  /** Loads raw bytes + meta, enforcing workspace ownership (fail-closed). */
  async readForWorkspace(workspaceId: string, attachmentId: string): Promise<{ meta: AttachmentMeta; bytes: Buffer }> {
    const meta = await this.requireOwned(workspaceId, attachmentId);
    const bytes = await this.bytes.read(meta.workspaceId, meta.storedFilename);
    return { meta, bytes };
  }

  /**
   * Resolves `attachment://<id>` refs to `data:<mime>;base64,...` URLs for
   * model input. In-memory only - callers persist the original refs.
   */
  async resolveDataUrls(workspaceId: string, attachmentIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of new Set(attachmentIds)) {
      const { meta, bytes } = await this.readForWorkspace(workspaceId, id);
      out.set(id, `data:${meta.mediaType};base64,${bytes.toString('base64')}`);
    }
    return out;
  }

  /** Marks referenced attachments as linked (expiry cleared) after ownership check. */
  async markLinked(workspaceId: string, attachmentIds: string[]): Promise<void> {
    for (const id of new Set(attachmentIds)) {
      await this.requireOwned(workspaceId, id);
      await this.repo.markLinked(id);
    }
  }

  /**
   * Deletes pending uploads past expiry (bytes + meta). Per-item fail-open:
   * one bad file must not abort the sweep; failures are returned (never
   * swallowed) so the caller - the apps layer - can log them.
   */
  async sweepExpiredPending(now: Date = new Date()): Promise<AttachmentSweepResult> {
    const expired = await this.repo.listExpiredPending(now);
    let deleted = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const meta of expired) {
      try {
        await this.bytes.remove(meta.workspaceId, meta.storedFilename);
        await this.repo.deleteMeta(meta.id);
        deleted += 1;
      } catch (err) {
        failures.push({ id: meta.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (failures.length > 0) {
      return { scanned: expired.length, deleted, failures };
    }
    return { scanned: expired.length, deleted, failures: [] };
  }

  private async requireOwned(workspaceId: string, attachmentId: string): Promise<AttachmentMeta> {
    const meta = await this.repo.findMeta(attachmentId);
    if (!meta) throw new AttachmentNotFoundError(attachmentId);
    if (meta.workspaceId !== workspaceId) throw new AttachmentForbiddenError(attachmentId, workspaceId);
    return meta;
  }
}
