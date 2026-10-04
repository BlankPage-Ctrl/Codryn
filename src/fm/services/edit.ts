import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult } from '../types/index.js';
import { normalizeRequestedPath, resolveSafePath } from '../utils/path.js';
import { fail, mapFsError, ok } from '../utils/result.js';
import { toLineNumberedResult } from '../utils/content.js';
import { unifiedDiff } from '../utils/diff.js';
import { withFileLock } from '../utils/mutex.js';
import { compressToBlob, hashBytes } from '../utils/snapshot.js';
import { EditFileInputSchema, type EditFileData, type EditFileInput } from '../types/edit.js';
import {
  FileEditContextSchema,
  type FileEditContext,
  type IFileHistoryStorage,
} from '../types/history.js';
import { applyEditsAtomic, EditFailedError } from '../engines/edit.js';

// Snapshots larger than this keep hashes + diff preview only; the
// before-image is marked truncated and the path reverts as a conflict
// (operator decides) instead of risking an unbounded DB row.
const MAX_SNAPSHOT_BYTES = 1_000_000;

export class EditFileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
    private readonly history?: IFileHistoryStorage,
  ) {}

  async editFile(input: EditFileInput, ctx?: FileEditContext): Promise<FmResult<EditFileData>> {
    const parsed = EditFileInputSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return fail('VALIDATION_FAILED', msg);
    }

    const { path: requestedPath, edits, apply_order } = parsed.data;
    const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

    let absolutePath: string;
    try {
      absolutePath = resolveSafePath(this.workspaceRoot, requestedPath);
    } catch (error) {
      return mapFsError(error, 'PATH_TRAVERSAL', normalizeRequestedPath(requestedPath));
    }

    try {
      const result = await withFileLock(absolutePath, async (): Promise<FmResult<EditFileData>> => {
        const raw = await this.repository.readFile(absolutePath, this.workspaceRoot, {
          encoding: 'utf-8',
        });

        if (raw.encoding === 'base64') {
          return fail(
            'EDIT_FAILED',
            `Cannot edit binary file: "${normalizedRequestedPath}" (detected base64 encoding)`,
          );
        }

        let nextContent: string;
        try {
          nextContent = applyEditsAtomic(raw.content, edits, apply_order);
        } catch (e) {
          if (e instanceof EditFailedError) {
            return fail('EDIT_FAILED', e.details.reason, e.details);
          }
          throw e;
        }

        // Diffed against the exact base that was edited (no TOCTOU gap).
        const diffed = unifiedDiff(raw.content, nextContent);

        // Ledger insert goes BEFORE the write: a crash between the two
        // leaves a phantom entry whose before-image equals the live file,
        // so a later revert is a harmless no-op. The reverse order (write
        // then insert) would leave an unrevertable edit on ledger failure.
        // Best-effort: the edit itself must never fail because the ledger
        // is unavailable.
        await this.recordHistory(ctx, {
          relativePath: toRelativePathForResult(this.workspaceRoot, absolutePath),
          beforeContent: raw.content,
          nextContent,
          diffPreview: diffed.diff,
        });

        await this.repository.writeFile(absolutePath, nextContent);

        const numbered = toLineNumberedResult(nextContent);
        const statsContent = Buffer.byteLength(nextContent, 'utf-8');

        const data: EditFileData = {
          path: toRelativePathForResult(this.workspaceRoot, absolutePath),
          appliedEdits: edits.length,
          totalLines: numbered.totalLines,
          content: nextContent,
          contentWithLineNumbers: numbered.contentWithLineNumbers,
          encoding: 'utf-8',
          size: statsContent,
          diff: diffed.diff,
          diffTruncated: diffed.truncated,
        };

        return ok(data, {
          requestedPath: normalizedRequestedPath,
          workspaceRoot: path.resolve(this.workspaceRoot),
        });
      });
      return result;
    } catch (error) {
      if (error instanceof EditFailedError) {
        return fail('EDIT_FAILED', error.details.reason, error.details);
      }
      const maybeFmError = error as { success?: boolean; error?: { code?: string } };
      if (maybeFmError && maybeFmError.success === false && maybeFmError.error?.code) {
        return maybeFmError as unknown as FmResult<EditFileData>;
      }
      return mapFsError(error, 'EDIT_FAILED', normalizeRequestedPath(requestedPath));
    }
  }

  private async recordHistory(
    ctx: FileEditContext | undefined,
    snapshot: {
      relativePath: string;
      beforeContent: string;
      nextContent: string;
      diffPreview: string;
    },
  ): Promise<void> {
    if (!this.history || !ctx) return;
    const parsedCtx = FileEditContextSchema.safeParse(ctx);
    if (!parsedCtx.success) return;
    const beforeBytes = Buffer.byteLength(snapshot.beforeContent, 'utf-8');
    const truncated = beforeBytes > MAX_SNAPSHOT_BYTES;
    try {
      await this.history.insert({
        workspaceId: parsedCtx.data.workspaceId,
        chatId: parsedCtx.data.chatId,
        messageId: parsedCtx.data.messageId,
        runId: parsedCtx.data.runId,
        toolCallId: parsedCtx.data.toolCallId,
        path: snapshot.relativePath,
        op: 'edit',
        existedBefore: true,
        beforeHash: hashBytes(snapshot.beforeContent),
        afterHash: hashBytes(snapshot.nextContent),
        beforeBlob: truncated ? null : compressToBlob(snapshot.beforeContent),
        snapshotTruncated: truncated,
        diffPreview: snapshot.diffPreview || null,
      });
    } catch {
      // Best effort: never fail the edit because the ledger write failed.
    }
  }
}

function toRelativePathForResult(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
  return rel === '' ? '/' : rel.split(path.sep).join('/');
}
