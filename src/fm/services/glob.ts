import path from 'node:path';
import type { GlobRepository } from '../repository/glob.js';
import type { FmResult } from '../types/index.js';
import type { GlobData, GlobOptions, GlobSearchInput, IGlobService } from '../types/glob.js';
import { GlobOptionsSchema } from '../types/glob.js';
import type { IgnoreOptions } from '../types/ignore.js';
import { DEFAULT_IGNORE_PATTERNS } from '../types/ignore.js';
import type { IFileSystem } from '../types/file-system.js';
import { createFmPendingApproval, type FmOutcome } from '../types/permission.js';
import { classifyWorkspacePath, normalizeRequestedPath, toRelativePath } from '../utils/path.js';
import { resolveOutsideTarget, type OutsideTarget } from '../utils/outside.js';
import { mapFsError, ok } from '../utils/result.js';
import { InvalidInputError } from '../errors/validation.js';

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Finds files by glob pattern over the workspace via ripgrep.
 */
export class GlobService implements IGlobService {
  private readonly ignorePatterns: readonly string[];

  constructor(
    private readonly repository: GlobRepository,
    private readonly workspaceRoot: string,
    opts: IgnoreOptions = {},
    /**
     * Optional FS for the symlink-escape probe. When absent, outside detection
     * falls back to pure string classification.
     */
    private readonly fileSystem?: IFileSystem,
  ) {
    this.ignorePatterns = [...(opts.ignorePatterns ?? [])];
  }

  private async probeRef(root: string, ref: string): Promise<OutsideTarget> {
    if (this.fileSystem) {
      return resolveOutsideTarget(this.fileSystem, root, ref);
    }
    const classified = classifyWorkspacePath(root, ref);
    return {
      inside: classified.inside,
      absolutePath: classified.absolutePath,
      viaSymlink: false,
    };
  }

  async glob(requestedPath: string, opts: GlobOptions): Promise<FmOutcome<GlobData>> {
    const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

    try {
      const parsedOpts = GlobOptionsSchema.safeParse(opts);
      if (!parsedOpts.success) {
        throw new InvalidInputError(
          `Invalid glob options: ${parsedOpts.error.issues.map((i) => i.message).join(', ')}`,
          { issues: parsedOpts.error.issues },
        );
      }
      const options = parsedOpts.data;
      const root = path.resolve(this.workspaceRoot);

      const target = await this.probeRef(root, requestedPath);
      if (!target.inside) {
        return createFmPendingApproval<GlobData>(
          {
            operation: 'glob',
            requestedPath,
            absolutePath: target.absolutePath,
            workspaceRoot: root,
            viaSymlink: target.viaSymlink,
            ...(target.symlinkPath !== undefined ? { symlinkPath: target.symlinkPath } : {}),
          },
          () =>
            this.globInside(
              target.absolutePath,
              normalizedRequestedPath,
              options,
              true,
              normalizedRequestedPath,
            ),
        );
      }

      const relative = toRelativePath(root, target.absolutePath);
      return await this.globInside(
        relative === '/' ? '.' : relative,
        normalizedRequestedPath,
        options,
        false,
        requestedPath,
      );
    } catch (error) {
      return mapFsError(error, 'INVALID_INPUT', normalizeRequestedPath(requestedPath));
    }
  }

  private async globInside(
    searchPath: string,
    requestedPath: string,
    options: GlobOptions,
    isOutside: boolean,
    errorPath: string,
  ): Promise<FmResult<GlobData>> {
    try {
      const root = path.resolve(this.workspaceRoot);
      const skipIgnore = options.includeIgnored === true || isOutside;
      const search: GlobSearchInput = {
        cwd: root,
        path: searchPath,
        requestedPath,
        pattern: options.pattern,
        includeGlobs: [],
        ignoreGlobs: skipIgnore ? [] : [...DEFAULT_IGNORE_PATTERNS, ...this.ignorePatterns],
        respectIgnoreFiles: !skipIgnore,
        maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      };

      const data = await this.repository.glob(root, search);
      return ok(data, {
        totalNodes: data.nodes.length,
        requestedPath,
        workspaceRoot: root,
      });
    } catch (error) {
      return mapFsError(error, 'INVALID_INPUT', normalizeRequestedPath(errorPath));
    }
  }
}
