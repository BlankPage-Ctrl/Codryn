import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult } from '../types/index.js';
import { normalizeRequestedPath, resolveSafePath } from '../utils/path.js';
import { fail, mapFsError, ok } from '../utils/result.js';
import { toLineNumberedResult } from '../utils/content.js';
import { withFileLock } from '../utils/mutex.js';
import { compressToBlob, hashBytes } from '../utils/snapshot.js';
import {
  CreateFileInputSchema,
  type CreateFileData,
  type CreateFileInput,
} from '../types/create.js';
import {
  FileEditContextSchema,
  type FileEditContext,
  type IFileHistoryStorage,
} from '../types/history.js';

const MAX_SNAPSHOT_BYTES = 1_000_000;

export class CreateFileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
    private readonly history?: IFileHistoryStorage,
  ) {}

  async createFile(
    input: CreateFileInput,
    ctx?: FileEditContext,
  ): Promise<FmResult<CreateFileData>> {
    const parsed = CreateFileInputSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return fail('VALIDATION_FAILED', msg);
    }

    const { path: requestedPath, content, overwrite } = parsed.data;
    const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

    let absolutePath: string;
    try {
      absolutePath = resolveSafePath(this.workspaceRoot, requestedPath);
    } catch (error) {
      return mapFsError(error, 'PATH_TRAVERSAL', normalizeRequestedPath(requestedPath));
    }

    // Prevent creating a directory path that ends with slash as file
    if (requestedPath.endsWith('/') && requestedPath !== '/') {
      return fail(
        'INVALID_INPUT',
        `Path must not end with slash for file creation: "${normalizedRequestedPath}"`,
      );
    }

    try {
      const result = await withFileLock(
        absolutePath,
        async (): Promise<FmResult<CreateFileData>> => {
          // Capture the before-image first (same lock, no TOCTOU gap).
          // Phantom-entry-safe like EditFileService: if the create below
          // fails, the recorded before-image still equals the live file
          // (or the file still does not exist), so revert is a no-op.
          await this.recordHistory(ctx, {
            absolutePath,
            relativePath: toRelativePathForResult(this.workspaceRoot, absolutePath),
            nextContent: content,
          });

          await this.repository.createFile(absolutePath, this.workspaceRoot, content, {
            overwrite,
          });

          const numbered = toLineNumberedResult(content);
          const size = Buffer.byteLength(content, 'utf-8');

          const data: CreateFileData = {
            path: toRelativePathForResult(this.workspaceRoot, absolutePath),
            size,
            totalLines: numbered.totalLines,
            content,
            contentWithLineNumbers: numbered.contentWithLineNumbers || undefined,
            encoding: 'utf-8',
          };

          // Validate output via Zod before returning
          return ok(data, {
            requestedPath: normalizedRequestedPath,
            workspaceRoot: path.resolve(this.workspaceRoot),
          });
        },
      );
      return result;
    } catch (error) {
      const maybeFmError = error as { success?: boolean; error?: { code?: string } };
      if (maybeFmError && maybeFmError.success === false && maybeFmError.error?.code) {
        return maybeFmError as unknown as FmResult<CreateFileData>;
      }
      return mapFsError(error, 'INTERNAL_ERROR', normalizeRequestedPath(requestedPath));
    }
  }

  private async recordHistory(
    ctx: FileEditContext | undefined,
    snapshot: { absolutePath: string; relativePath: string; nextContent: string },
  ): Promise<void> {
    if (!this.history || !ctx) return;
    const parsedCtx = FileEditContextSchema.safeParse(ctx);
    if (!parsedCtx.success) return;
    let before: Buffer | null = null;
    try {
      before = await this.repository.readBytes(snapshot.absolutePath);
    } catch (error) {
      // ENOENT = file does not exist yet (normal create path).
      // Any other read failure skips history; the create below will
      // surface the real error to the caller.
      const nodeErr = error as { code?: string };
      if (nodeErr?.code !== 'ENOENT') return;
    }
    const truncated = before !== null && before.length > MAX_SNAPSHOT_BYTES;
    try {
      await this.history.insert({
        workspaceId: parsedCtx.data.workspaceId,
        chatId: parsedCtx.data.chatId,
        messageId: parsedCtx.data.messageId,
        runId: parsedCtx.data.runId,
        toolCallId: parsedCtx.data.toolCallId,
        path: snapshot.relativePath,
        op: 'create',
        existedBefore: before !== null,
        beforeHash: before ? hashBytes(before) : null,
        afterHash: hashBytes(snapshot.nextContent),
        beforeBlob: before && !truncated ? compressToBlob(before) : null,
        snapshotTruncated: truncated,
        diffPreview: null,
      });
    } catch {
      // Best effort: never fail the create because the ledger write failed.
    }
  }
}

function toRelativePathForResult(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
  return rel === '' ? '/' : rel.split(path.sep).join('/');
}
