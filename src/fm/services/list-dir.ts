import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult, ListDirData, ListDirOptions } from '../types/index.js';
import type { IgnoreOptions } from '../types/ignore.js';
import { normalizeRequestedPath } from '../utils/path.js';
import { mapFsError, ok } from '../utils/result.js';
import { FileType, type FileNode } from '../types/index.js';

export class ListDirService {
  private readonly ignorePatterns: readonly string[];

  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
    opts: IgnoreOptions = {},
  ) {
    this.ignorePatterns = [...(opts.ignorePatterns ?? [])];
  }

  async listDir(requestedPath: string, opts: ListDirOptions = {}): Promise<FmResult<ListDirData>> {
    try {
      const target = await this.repository.checkOutsideTarget(this.workspaceRoot, requestedPath);
      // Listing is always allowed; only the ignore filter differs outside.
      return await this.listInside(target.absolutePath, requestedPath, opts, !target.inside);
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }

  private async listInside(
    absolutePath: string,
    requestedPath: string,
    opts: ListDirOptions,
    isOutside: boolean,
  ): Promise<FmResult<ListDirData>> {
    try {
      // Outside-approved listings skip workspace gitignore (it does not apply
      // out there); the repository's built-in defaults still apply.
      const data = await this.repository.listDir(absolutePath, this.workspaceRoot, {
        ignorePatterns: opts.includeIgnored === true || isOutside ? [] : [...this.ignorePatterns],
      });
      const sortedNodes = [...data.nodes].sort(compareFileNodes);
      const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

      return ok(
        { requestedPath: normalizedRequestedPath, nodes: sortedNodes },
        {
          totalNodes: sortedNodes.length,
          requestedPath: normalizedRequestedPath,
          workspaceRoot: path.resolve(this.workspaceRoot),
        },
      );
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }
}

function compareFileNodes(left: FileNode, right: FileNode): number {
  const rank = (node: FileNode): number =>
    node.type === FileType.DIRECTORY ? 0 : node.type === FileType.FILE ? 1 : 2;
  return rank(left) - rank(right) || left.name.localeCompare(right.name);
}
