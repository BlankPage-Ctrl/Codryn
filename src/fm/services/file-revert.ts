import type { FileRepository } from '../repository/file.js';
import { normalizeRequestedPath, resolveSafePath } from '../utils/path.js';
import { withFileLock } from '../utils/mutex.js';
import { decompressBlob, hashBytes } from '../utils/snapshot.js';
import { unifiedDiff } from '../utils/diff.js';
import { PathNotFoundError } from '../errors/not-found.js';
import { InvalidInputError } from '../errors/validation.js';
import {
  FileRevertPreviewSchema,
  FileRevertRequestSchema,
  FileRevertResultSchema,
  type FileConflictItem,
  type FileConflictWriter,
  type FileHistoryRowLike,
  type FileRestoreItem,
  type FileRevertPlanItem,
  type FileRevertPreview,
  type FileRevertRequest,
  type FileRevertResult,
  type IFileHistoryStorage,
} from '../types/history.js';

export class FileRevertService {
  constructor(
    private readonly repository: FileRepository,
    private readonly history: IFileHistoryStorage,
    private readonly workspaceRoot: string,
  ) {}

  /**
   * Read-only revert plan: what `revertFromMessages` WOULD do for the given
   * (suffix/deleted) messages, without touching the filesystem. Used for
   * pre-revert collision previews in the UI. Advisory by nature - the live
   * file can change between preview and revert; the revert result is
   * authoritative.
   */
  async previewFromMessages(input: FileRevertRequest): Promise<FileRevertPreview> {
    const { workspaceId, chatId, messageIds, force } = this.parseRequest(input);
    const forced = new Set(force ?? []);
    const byPath = await this.loadGrouped(chatId, messageIds);

    const files: FileRevertPlanItem[] = [];
    for (const [relativePath, scoped] of byPath) {
      const oldest = scoped[0];
      const newest = scoped[scoped.length - 1];
      if (!oldest || !newest) continue;
      const absolutePath = this.resolveHistoryPath(relativePath);
      const current = await this.readCurrent(absolutePath);
      files.push(await this.planPath(workspaceId, relativePath, oldest, newest, current, forced));
    }
    return FileRevertPreviewSchema.parse({ files });
  }

  /**
   * Restore every path touched by the given (suffix/deleted) messages to the
   * oldest recorded before-image - i.e. the file state at the checkpoint
   * before the first in-scope AI mutation.
   *
   * Collision policy is detect-and-skip: when the live file no longer
   * matches the newest recorded afterHash, something outside the revert
   * scope (another chat, the user, a shell command) changed it afterwards.
   * That path is reported in `conflicts` and left untouched unless listed
   * in `force`.
   */
  async revertFromMessages(input: FileRevertRequest): Promise<FileRevertResult> {
    const { workspaceId, chatId, messageIds, force } = this.parseRequest(input);
    const forced = new Set(force ?? []);
    const byPath = await this.loadGrouped(chatId, messageIds);

    const restored: FileRestoreItem[] = [];
    const conflicts: FileConflictItem[] = [];

    for (const [relativePath, scoped] of byPath) {
      const oldest = scoped[0];
      const newest = scoped[scoped.length - 1];
      if (!oldest || !newest) continue;
      const absolutePath = this.resolveHistoryPath(relativePath);

      const outcome = await withFileLock(absolutePath, async () => {
        const current = await this.readCurrent(absolutePath);
        const plan = await this.planPath(
          workspaceId,
          relativePath,
          oldest,
          newest,
          current,
          forced,
        );
        if (plan.status === 'conflict' || plan.reason !== null) {
          const conflict: FileConflictItem = {
            path: plan.path,
            reason: plan.reason ?? 'MODIFIED_AFTER',
            expectedHash: plan.expectedHash,
            currentHash: plan.currentHash,
            lastWriter: plan.lastWriter,
            ...(plan.diffPreview !== undefined ? { diffPreview: plan.diffPreview } : {}),
          };
          return { kind: 'conflict' as const, conflict };
        }

        if (oldest.existedBefore === 0) {
          // AI created this file: revert means deleting it.
          try {
            await this.repository.deleteFile(absolutePath, this.workspaceRoot);
          } catch (error) {
            if (error instanceof PathNotFoundError) {
              // Already gone (e.g. phantom entry after a failed create).
              return {
                kind: 'restored' as const,
                item: { path: relativePath, op: 'deleted' as const },
              };
            }
            throw error;
          }
          return {
            kind: 'restored' as const,
            item: { path: relativePath, op: 'deleted' as const },
          };
        }

        // Plan guarantees a usable snapshot here.
        const beforeBytes = decompressBlob(oldest.beforeBlob as string);
        await this.repository.writeFile(absolutePath, beforeBytes.toString('utf-8'));
        return { kind: 'restored' as const, item: { path: relativePath, op: 'restored' as const } };
      });

      if (outcome.kind === 'conflict') conflicts.push(outcome.conflict);
      else restored.push(outcome.item);
    }

    return FileRevertResultSchema.parse({ restored, conflicts });
  }

  private parseRequest(input: FileRevertRequest): {
    workspaceId: string;
    chatId: string;
    messageIds: string[];
    force?: string[];
  } {
    const parsed = FileRevertRequestSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new InvalidInputError(`Invalid file revert request: ${msg}`, {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /** History entries grouped by path, oldest-first per path, paths sorted. */
  private async loadGrouped(
    chatId: string,
    messageIds: string[],
  ): Promise<Array<[string, FileHistoryRowLike[]]>> {
    const entries = await this.history.listByMessageIds(chatId, messageIds);
    const byPath = new Map<string, FileHistoryRowLike[]>();
    for (const entry of entries) {
      const list = byPath.get(entry.path) ?? [];
      list.push(entry);
      byPath.set(entry.path, list);
    }
    return [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  private resolveHistoryPath(relativePath: string): string {
    try {
      return resolveSafePath(this.workspaceRoot, relativePath);
    } catch (error) {
      throw new InvalidInputError(
        `Invalid history path: "${normalizeRequestedPath(relativePath)}"`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Decide the fate of one path. Shared by preview and revert so the two
   * can never drift apart.
   */
  private async planPath(
    workspaceId: string,
    relativePath: string,
    oldest: FileHistoryRowLike,
    newest: FileHistoryRowLike,
    current: { hash: string | null; text: string | null },
    forced: Set<string>,
  ): Promise<FileRevertPlanItem> {
    const op: 'restored' | 'deleted' = oldest.existedBefore === 0 ? 'deleted' : 'restored';
    const expectedHash = newest.afterHash;
    const base = {
      path: relativePath,
      op,
      expectedHash,
      currentHash: current.hash,
    };

    const hasSnapshot =
      oldest.existedBefore === 0 || (oldest.beforeBlob != null && oldest.snapshotTruncated !== 1);
    if (!hasSnapshot) {
      return {
        ...base,
        status: 'conflict',
        reason: 'NO_SNAPSHOT',
        lastWriter: await this.findLastWriter(workspaceId, relativePath),
      };
    }

    if (current.hash !== expectedHash && !forced.has(relativePath)) {
      return {
        ...base,
        status: 'conflict',
        reason: 'MODIFIED_AFTER',
        lastWriter: await this.findLastWriter(workspaceId, relativePath),
        diffPreview: this.checkpointDiff(oldest, current.text),
      };
    }

    return { ...base, status: 'ok', reason: null, lastWriter: null };
  }

  private async readCurrent(
    absolutePath: string,
  ): Promise<{ hash: string | null; text: string | null }> {
    try {
      const bytes = await this.repository.readBytes(absolutePath);
      const isBinary = bytes.subarray(0, 512).includes(0);
      return { hash: hashBytes(bytes), text: isBinary ? null : bytes.toString('utf-8') };
    } catch (error) {
      const nodeErr = error as { code?: string };
      if (nodeErr?.code === 'ENOENT') return { hash: null, text: null };
      throw error;
    }
  }

  /** Preview of checkpoint-before vs live file (best effort, null when unavailable). */
  private checkpointDiff(oldest: FileHistoryRowLike, currentText: string | null): string | null {
    if (currentText == null || !oldest.beforeBlob || oldest.snapshotTruncated === 1) return null;
    try {
      const beforeText = decompressBlob(oldest.beforeBlob).toString('utf-8');
      return unifiedDiff(beforeText, currentText).diff || null;
    } catch {
      return null;
    }
  }

  private async findLastWriter(
    workspaceId: string,
    relativePath: string,
  ): Promise<FileConflictWriter | null> {
    try {
      const latest = await this.history.findLatestByWorkspacePath(workspaceId, relativePath);
      if (!latest) return null;
      return { chatId: latest.chatId, messageId: latest.messageId, createdAt: latest.createdAt };
    } catch {
      return null;
    }
  }
}
