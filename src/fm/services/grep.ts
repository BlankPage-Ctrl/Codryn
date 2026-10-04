import path from 'node:path';
import type { GrepRepository } from '../repository/grep.js';
import type { FmResult } from '../types/index.js';
import type { GrepData, GrepOptions, IGrepService, GrepSearchInput } from '../types/grep.js';
import { GrepOptionsSchema } from '../types/grep.js';
import type { IgnoreOptions } from '../types/ignore.js';
import { DEFAULT_IGNORE_PATTERNS } from '../types/ignore.js';
import type { IFileSystem } from '../types/file-system.js';
import { createFmPendingApproval, type FmOutcome } from '../types/permission.js';
import {
  classifyWorkspacePath,
  normalizeRequestedPath,
  resolveSafePath,
  toRelativePath,
} from '../utils/path.js';
import { resolveOutsideTarget, type OutsideTarget } from '../utils/outside.js';
import { mapFsError, ok } from '../utils/result.js';
import { InvalidInputError } from '../errors/validation.js';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Content search over the workspace via ripgrep.
 *
 * - `folders[]` selects search roots (defaults to `requestedPath`).
 * - `files[]` is an allowlist AND-combined with the roots: a match is kept
 *   only when its workspace-relative path is listed in `files[]`.
 * - Line numbers and line text come straight from `rg --json`, so no
 *   `ReadFileService` round-trip is needed.
 */
export class GrepService implements IGrepService {
  private readonly ignorePatterns: readonly string[];

  constructor(
    private readonly repository: GrepRepository,
    private readonly workspaceRoot: string,
    opts: IgnoreOptions = {},
    /**
     * Optional FS for the symlink-escape probe. When absent, outside detection
     * falls back to pure string classification (rg never follows dir symlinks
     * without `--follow`, so the residual risk is low and documented).
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

  async grep(
    requestedPath: string,
    pattern: string,
    opts: GrepOptions = {},
  ): Promise<FmOutcome<GrepData>> {
    const normalizedRequestedPath = requestedPath === '' ? '/' : requestedPath;

    try {
      const parsedOpts = GrepOptionsSchema.safeParse(opts);
      if (!parsedOpts.success) {
        throw new InvalidInputError(
          `Invalid grep options: ${parsedOpts.error.issues.map((i) => i.message).join(', ')}`,
          { issues: parsedOpts.error.issues },
        );
      }
      const options = parsedOpts.data;

      if (pattern.trim() === '') {
        return ok(
          { pattern, matches: [], truncated: false },
          {
            requestedPath: normalizedRequestedPath,
            workspaceRoot: path.resolve(this.workspaceRoot),
          },
        );
      }

      const root = path.resolve(this.workspaceRoot);
      const folders =
        options.folders !== undefined && options.folders.length > 0
          ? options.folders
          : [requestedPath];
      const files =
        options.files !== undefined && options.files.length > 0 ? options.files : undefined;

      // Every root/file is probed: string-outside never touches the FS,
      // string-inside gets the symlink-escape probe.
      const folderTargets = await Promise.all(folders.map((folder) => this.probeRef(root, folder)));
      const fileTargets = files
        ? await Promise.all(files.map((file) => this.probeRef(root, file)))
        : undefined;
      const allTargets = [...folderTargets, ...(fileTargets ?? [])];
      const outsideTargets = allTargets.filter((t) => !t.inside);

      if (outsideTargets.length > 0) {
        // One approval covers all outside roots of this query.
        const firstOutside = outsideTargets[0]!;
        const firstSymlink = outsideTargets.find((t) => t.symlinkPath !== undefined);
        return createFmPendingApproval<GrepData>(
          {
            operation: 'grep',
            requestedPath,
            absolutePath: firstOutside.absolutePath,
            workspaceRoot: root,
            viaSymlink: outsideTargets.some((t) => t.viaSymlink),
            ...(firstSymlink?.symlinkPath !== undefined
              ? { symlinkPath: firstSymlink.symlinkPath }
              : {}),
            outsidePaths: [...new Set(outsideTargets.map((t) => t.absolutePath))],
          },
          () =>
            this.grepOutside(root, normalizedRequestedPath, pattern, options, {
              folders: folderTargets,
              files: fileTargets,
            }),
        );
      }

      // resolveSafePath confines every root/file to the workspace (throws
      // PathTraversalError otherwise) and toRelativePath canonicalizes for
      // rg argv + files-allowlist comparison.
      const searchPaths = folders.map((folder) => {
        const relative = toRelativePath(root, resolveSafePath(root, folder));
        return relative === '/' ? '.' : relative;
      });
      const fileAllowlist =
        options.files !== undefined && options.files.length > 0
          ? new Set(options.files.map((file) => toRelativePath(root, resolveSafePath(root, file))))
          : undefined;

      const search: GrepSearchInput = {
        cwd: root,
        pattern,
        paths: searchPaths,
        fixedStrings: options.regex === false,
        caseInsensitive: options.caseInsensitive !== false,
        globs: options.include ?? [],
        ignoreGlobs:
          options.includeIgnored === true
            ? []
            : [...DEFAULT_IGNORE_PATTERNS, ...this.ignorePatterns],
        respectIgnoreFiles: options.includeIgnored !== true,
        maxFileSize: options.maxFileSize,
        maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };

      const data = await this.repository.grep(root, search);
      const matches =
        fileAllowlist === undefined
          ? data.matches
          : data.matches.filter((match) => fileAllowlist.has(match.path));

      return ok(
        { ...data, matches },
        {
          requestedPath: normalizedRequestedPath,
          workspaceRoot: root,
        },
      );
    } catch (error) {
      return mapFsError(error, 'INTERNAL_ERROR', normalizeRequestedPath(requestedPath));
    }
  }

  /**
   * Approved-outside execution: every search root is passed to `rg` as an
   * absolute path (rg accepts absolute argv from any cwd), workspace ignore
   * rules are dropped (`--no-ignore`), and match labels stay in the same
   * workspace-relative space so the files-allowlist comparison is unchanged.
   */
  private async grepOutside(
    root: string,
    normalizedRequestedPath: string,
    pattern: string,
    options: {
      regex?: boolean;
      caseInsensitive?: boolean;
      include?: string[];
      maxFileSize?: string;
      maxResults?: number;
      timeoutMs?: number;
    },
    targets: { folders: OutsideTarget[]; files: OutsideTarget[] | undefined },
  ): Promise<FmResult<GrepData>> {
    try {
      const searchPaths = [
        ...new Set([
          ...targets.folders.map((t) => t.absolutePath),
          ...(targets.files ?? []).map((t) => t.absolutePath),
        ]),
      ];
      // Same workspace-relative label space as the normal path, so the
      // files-allowlist comparison below stays consistent for inside and
      // outside matches alike.
      const fileAllowlist =
        targets.files !== undefined
          ? new Set(targets.files.map((t) => toRelativePath(root, t.absolutePath)))
          : undefined;

      const search: GrepSearchInput = {
        cwd: root,
        pattern,
        paths: searchPaths,
        fixedStrings: options.regex === false,
        caseInsensitive: options.caseInsensitive !== false,
        globs: options.include ?? [],
        ignoreGlobs: [],
        respectIgnoreFiles: false,
        maxFileSize: options.maxFileSize,
        maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };

      const data = await this.repository.grep(root, search);
      const matches =
        fileAllowlist === undefined
          ? data.matches
          : data.matches.filter((match) => fileAllowlist.has(match.path));
      return ok(
        { ...data, matches },
        {
          requestedPath: normalizedRequestedPath,
          workspaceRoot: root,
        },
      );
    } catch (error) {
      return mapFsError(error, 'INTERNAL_ERROR', normalizedRequestedPath);
    }
  }
}
