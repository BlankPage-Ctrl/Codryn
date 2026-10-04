import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult, ReadFileData, ReadFileOptions } from '../types/index.js';
import { createFmPendingApproval, type FmOutcome } from '../types/permission.js';
import { normalizeRequestedPath } from '../utils/path.js';
import { mapFsError, ok } from '../utils/result.js';
import { parseContentToLines, sliceLinesByRange, toLineNumberedResult } from '../utils/content.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export class ReadFileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
  ) {}

  async readFile(
    requestedPath: string,
    opts: ReadFileOptions = {},
  ): Promise<FmOutcome<ReadFileData>> {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const withLineNumbers = opts.withLineNumbers ?? true;
    const hasPagination = opts.startLine != null || opts.endLine != null;
    const shouldNumber = withLineNumbers || hasPagination;

    try {
      const target = await this.repository.checkOutsideTarget(this.workspaceRoot, requestedPath);
      if (!target.inside) {
        // Outside the workspace: no FS access yet - hand a pending approval
        // to the caller (agent tool => HITL), mirroring shell permission flow.
        return createFmPendingApproval<ReadFileData>(
          {
            operation: 'read',
            requestedPath,
            absolutePath: target.absolutePath,
            workspaceRoot: path.resolve(this.workspaceRoot),
            viaSymlink: target.viaSymlink,
            ...(target.symlinkPath !== undefined ? { symlinkPath: target.symlinkPath } : {}),
          },
          () =>
            this.readInside(target.absolutePath, requestedPath, {
              maxBytes,
              encoding: opts.encoding,
              shouldNumber,
              startLine: opts.startLine,
              endLine: opts.endLine,
            }),
        );
      }
      return await this.readInside(target.absolutePath, requestedPath, {
        maxBytes,
        encoding: opts.encoding,
        shouldNumber,
        startLine: opts.startLine,
        endLine: opts.endLine,
      });
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }

  private async readInside(
    absolutePath: string,
    requestedPath: string,
    opts: {
      maxBytes: number;
      encoding: ReadFileOptions['encoding'];
      shouldNumber: boolean;
      startLine?: number;
      endLine?: number;
    },
  ): Promise<FmResult<ReadFileData>> {
    try {
      const hasRange = opts.startLine != null || opts.endLine != null;
      const raw = await this.repository.readFile(absolutePath, this.workspaceRoot, {
        encoding: opts.encoding,
        // Ordering fix: when paginating, slice lines BEFORE the byte cap
        // (applied below on the window). Capping first could return an
        // empty window for far ranges even though the lines exist.
        maxBytes: hasRange ? undefined : opts.maxBytes,
      });

      let data: ReadFileData = raw;

      if (opts.shouldNumber && raw.encoding === 'utf-8') {
        if (!hasRange) {
          const numbered = toLineNumberedResult(raw.content);
          data = {
            ...raw,
            totalLines: numbered.totalLines,
            contentWithLineNumbers: numbered.contentWithLineNumbers,
          };
        } else {
          const numbered = toLineNumberedResult(raw.content, {
            startLine: opts.startLine,
            endLine: opts.endLine,
          });
          const slicedRaw = sliceLinesByRange(
            parseContentToLines(raw.content),
            opts.startLine,
            opts.endLine,
          )
            .map((l) => l.text)
            // Preserve the file's dominant ending in the window so a CRLF
            // file does not come back as LF-only when paginating.
            .join(raw.content.includes('\r\n') ? '\r\n' : '\n');
          // Byte-cap the window (numbered view), never a whole-file prefix,
          // so a far window returns its head instead of coming back empty.
          let out = numbered.contentWithLineNumbers;
          let truncated = false;
          if (Buffer.byteLength(out, 'utf8') > opts.maxBytes) {
            out = Buffer.from(out, 'utf8').subarray(0, opts.maxBytes).toString('utf8');
            truncated = true;
          }
          data = {
            ...raw,
            content: slicedRaw,
            totalLines: numbered.totalLines,
            contentWithLineNumbers: out,
            truncated,
          };
        }
      }

      return ok(data, {
        requestedPath: requestedPath === '' ? '/' : requestedPath,
        workspaceRoot: path.resolve(this.workspaceRoot),
      });
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }
}
