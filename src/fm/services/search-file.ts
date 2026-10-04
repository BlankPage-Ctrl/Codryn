import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult, SearchFilesData, SearchFilesOptions } from '../types/index.js';
import type { IgnoreOptions } from '../types/ignore.js';
import { createFmPendingApproval, type FmOutcome } from '../types/permission.js';
import { normalizeRequestedPath } from '../utils/path.js';
import { mapFsError, ok } from '../utils/result.js';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_DEPTH = 12;

export class SearchFilesService {
  private readonly ignorePatterns: readonly string[];

  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
    opts: IgnoreOptions = {},
  ) {
    this.ignorePatterns = [...(opts.ignorePatterns ?? [])];
  }

  async searchFiles(
    requestedPath: string,
    query: string,
    opts: SearchFilesOptions = {},
  ): Promise<FmOutcome<SearchFilesData>> {
    const q = query.trim();
    const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

    if (!q) {
      return ok(
        { query: q, matches: [] },
        {
          requestedPath: normalizedRequestedPath,
          workspaceRoot: path.resolve(this.workspaceRoot),
        },
      );
    }

    try {
      const target = await this.repository.checkOutsideTarget(this.workspaceRoot, requestedPath);
      if (!target.inside) {
        return createFmPendingApproval<SearchFilesData>(
          {
            operation: 'search',
            requestedPath,
            absolutePath: target.absolutePath,
            workspaceRoot: path.resolve(this.workspaceRoot),
            viaSymlink: target.viaSymlink,
            ...(target.symlinkPath !== undefined ? { symlinkPath: target.symlinkPath } : {}),
          },
          () => this.searchInside(target.absolutePath, q, normalizedRequestedPath, opts, true),
        );
      }
      return await this.searchInside(target.absolutePath, q, normalizedRequestedPath, opts, false);
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }

  private async searchInside(
    absolutePath: string,
    query: string,
    normalizedRequestedPath: string,
    opts: SearchFilesOptions,
    isOutside: boolean,
  ): Promise<FmResult<SearchFilesData>> {
    try {
      const data = await this.repository.searchFiles(absolutePath, this.workspaceRoot, query, {
        maxResults: opts.maxResults ?? DEFAULT_MAX_RESULTS,
        maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
        caseInsensitive: opts.caseInsensitive,
        matchPath: opts.matchPath,
        // Workspace gitignore does not apply outside the workspace.
        ignorePatterns: opts.includeIgnored === true || isOutside ? [] : [...this.ignorePatterns],
      });

      return ok(data, {
        requestedPath: normalizedRequestedPath,
        workspaceRoot: path.resolve(this.workspaceRoot),
      });
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(normalizedRequestedPath));
    }
  }
}
