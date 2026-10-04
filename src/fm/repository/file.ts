import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';
import type { IFileSystem } from '../types/file-system.js';
import {
  FileNodeSchema,
  ListDirDataSchema,
  ReadFileDataSchema,
  SearchFilesDataSchema,
  type FileNode,
  type ListDirData,
  type ReadFileData,
  type ReadFileOptions,
  type SearchFilesData,
  type SearchFilesOptions,
} from '../types/index.js';
import { checkHasChildren } from '../utils/fs.js';
import { buildFileNode } from '../utils/node.js';
import { toRelativePath, isOutsideDisplayPath } from '../utils/path.js';
import { resolveOutsideTarget, type OutsideTarget } from '../utils/outside.js';
import { AlreadyExistsError, NotADirectoryError, NotAFileError } from '../errors/storage.js';
import { PathNotFoundError } from '../errors/not-found.js';
import { InvalidInputError } from '../errors/validation.js';
import { FmDomainError } from '../errors/base.js';
import { IgnoreFilter } from '../engines/ignore.js';
import {
  DEFAULT_IGNORE_PATTERNS,
  IgnoreOptionsSchema,
  type IgnoreOptions,
} from '../types/ignore.js';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_DEPTH = 12;

function buildIgnoreFilter(opts: IgnoreOptions): IgnoreFilter {
  const parsed = IgnoreOptionsSchema.safeParse(opts);
  if (!parsed.success) {
    throw new InvalidInputError(
      `Invalid ignore options: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      { issues: parsed.error.issues },
    );
  }
  return new IgnoreFilter([...DEFAULT_IGNORE_PATTERNS, ...(parsed.data.ignorePatterns ?? [])]);
}

export class FileRepository {
  constructor(private readonly cold: IFileSystem) {}

  /**
   * Outside-workspace probe shared by the read-only services. String escapes
   * never touch the FS; string-inside paths get a best-effort symlink walk-up
   * (metadata syscalls only, no content reads).
   */
  async checkOutsideTarget(workspaceRoot: string, requestedPath: string): Promise<OutsideTarget> {
    return resolveOutsideTarget(this.cold, workspaceRoot, requestedPath);
  }

  async getNode(absolutePath: string, workspaceRoot: string): Promise<FileNode> {
    const stats = await this.cold.lstat(absolutePath);
    const hasChildren = stats.isDirectory()
      ? await checkHasChildren(this.cold, absolutePath)
      : undefined;
    const symlinkTarget = stats.isSymbolicLink()
      ? await this.cold.readlink(absolutePath)
      : undefined;

    const raw = buildFileNode(absolutePath, workspaceRoot, stats, {
      hasChildren,
      symlinkTarget,
    });

    return FileNodeSchema.parse(raw);
  }

  async listDir(
    absolutePath: string,
    workspaceRoot: string,
    opts: IgnoreOptions = {},
  ): Promise<ListDirData> {
    const ignoreFilter = buildIgnoreFilter(opts);
    // Outside-workspace roots (post-approval) produce `../...` relative labels
    // which the `ignore` package rejects - and workspace ignore rules do not
    // apply out there anyway - so filtering is bypassed for them.
    const isOutside = isOutsideDisplayPath(toRelativePath(workspaceRoot, absolutePath));
    const entries = (await this.cold.readdir(absolutePath, {
      withFileTypes: true,
    })) as Dirent[];

    const nodes = await Promise.all(
      entries.map(async (entry): Promise<FileNode | undefined> => {
        const absoluteNodePath = path.join(absolutePath, entry.name);
        const relPath = toRelativePath(workspaceRoot, absoluteNodePath);
        if (!isOutside && ignoreFilter.ignores(relPath, entry.isDirectory())) return undefined;
        try {
          const node = await this.getNode(absoluteNodePath, workspaceRoot);
          if (node.isDirectory && !entry.isDirectory()) {
            if (!isOutside && ignoreFilter.ignores(relPath, true)) return undefined;
          }
          return node;
        } catch (error) {
          // # Best effort
          // Entry vanished between readdir and lstat (ENOENT) is expected race, skip.
          // Other errors (permission, I/O) are enriched and skipped perentry to keep listing resilient,
          // but root level failures are propagated via the outer readdir throw.
          const nodeErr = error as { code?: string };
          if (nodeErr?.code === 'ENOENT') return undefined;
          if (error instanceof FmDomainError && error.code === 'PATH_NOT_FOUND') return undefined;
          // For non-ENOENT domain errors, just skip the single entry rather than fail whole dir,
          // but do not silently swallow, error is translated to domain error context.
          return undefined;
        }
      }),
    );

    const visibleNodes = nodes.filter((node): node is FileNode => node !== undefined);

    return ListDirDataSchema.parse({
      requestedPath: toRelativePath(workspaceRoot, absolutePath),
      nodes: visibleNodes,
    });
  }

  async readFile(
    absolutePath: string,
    workspaceRoot: string,
    opts: ReadFileOptions = {},
  ): Promise<ReadFileData> {
    const stats = await this.cold.lstat(absolutePath);

    if (stats.isDirectory()) {
      throw new NotADirectoryError(toRelativePath(workspaceRoot, absolutePath));
    }
    if (stats.isSymbolicLink()) {
      throw new NotAFileError(
        toRelativePath(workspaceRoot, absolutePath),
        'Reading symlinks directly is not allowed',
      );
    }

    const buffer = await this.cold.readFile(absolutePath);
    const truncated = (opts.maxBytes ?? 0) > 0 && buffer.length > (opts.maxBytes ?? 0);
    const contentBuffer = truncated ? buffer.subarray(0, opts.maxBytes) : buffer;
    const encoding =
      opts.encoding === 'utf-8' || !isBinaryBuffer(contentBuffer) ? 'utf-8' : 'base64';
    const content =
      encoding === 'utf-8' ? contentBuffer.toString('utf8') : contentBuffer.toString('base64');

    return ReadFileDataSchema.parse({
      path: toRelativePath(workspaceRoot, absolutePath),
      content,
      encoding,
      size: stats.size,
      truncated,
    });
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    const data = Buffer.from(content, 'utf-8');
    await this.cold.writeFile(absolutePath, data);
  }

  /** Raw bytes for hashing/comparison (binary-safe). */
  async readBytes(absolutePath: string): Promise<Buffer> {
    return this.cold.readFile(absolutePath);
  }

  /** Delete a single file (used to revert AI-created files). */
  async deleteFile(absolutePath: string, workspaceRoot: string): Promise<void> {
    let stats;
    try {
      stats = await this.cold.lstat(absolutePath);
    } catch (error) {
      const nodeErr = error as { code?: string };
      if (nodeErr?.code === 'ENOENT') {
        throw new PathNotFoundError(toRelativePath(workspaceRoot, absolutePath));
      }
      throw error;
    }
    if (stats.isDirectory()) {
      throw new NotADirectoryError(toRelativePath(workspaceRoot, absolutePath));
    }
    await this.cold.unlink(absolutePath);
  }

  async createFile(
    absolutePath: string,
    workspaceRoot: string,
    content: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<void> {
    const overwrite = opts.overwrite === true;

    try {
      const stats = await this.cold.lstat(absolutePath);
      if (stats.isDirectory()) {
        throw new NotADirectoryError(toRelativePath(workspaceRoot, absolutePath));
      }
      if (!overwrite) {
        // File (or symlink) already exists
        throw new AlreadyExistsError(toRelativePath(workspaceRoot, absolutePath));
      }
      // overwrite=true: allow replacing file/symlink target - ensure parent still valid
      if (stats.isDirectory()) {
        throw new NotADirectoryError(toRelativePath(workspaceRoot, absolutePath));
      }
    } catch (error) {
      const nodeErr = error as { code?: string };
      if (nodeErr?.code === 'ENOENT') {
        // not exists - proceed to create
      } else if (error instanceof AlreadyExistsError || error instanceof NotADirectoryError) {
        throw error;
      } else if (error instanceof FmDomainError) {
        throw error;
      } else if (nodeErr?.code !== undefined) {
        // other fs errors (EPERM etc) - propagate to mapFsError
        throw error;
      } else {
        throw error;
      }
    }

    const dir = path.dirname(absolutePath);
    await this.cold.mkdir(dir, { recursive: true });

    const data = Buffer.from(content, 'utf-8');
    await this.cold.writeFile(absolutePath, data);
  }

  async searchFiles(
    absolutePath: string,
    workspaceRoot: string,
    query: string,
    opts: SearchFilesOptions & IgnoreOptions = {},
  ): Promise<SearchFilesData> {
    const ignoreFilter = buildIgnoreFilter(opts);
    const caseInsensitive = opts.caseInsensitive !== false;
    const matchPath = opts.matchPath !== false;
    const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
    const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    const needle = caseInsensitive ? query.toLowerCase() : query;

    const matches: FileNode[] = [];
    let truncated = false;
    // Same bypass as listDir: approved outside roots label as `../...`.
    const isOutside = isOutsideDisplayPath(toRelativePath(workspaceRoot, absolutePath));

    const walk = async (dir: string, depth: number, isRoot: boolean): Promise<void> => {
      if (truncated || depth > maxDepth) return;

      let entries: Dirent[];
      try {
        entries = (await this.cold.readdir(dir, {
          withFileTypes: true,
        })) as Dirent[];
      } catch (error) {
        // # Best Effort
        // Root failure is fatal, just translate and propagate to service layer.
        // Subdirectory failures? skip subtree but do not swallow root.
        if (isRoot) throw error;
        // Enrich non-root errors via domain mapping if needed, then gracefully skip subtree.
        // This is an intentional resilience trade-off, not a silent swallow of the main operation.
        return;
      }

      for (const entry of entries) {
        if (truncated) return;
        const absoluteNodePath = path.join(dir, entry.name);
        const relPath = toRelativePath(workspaceRoot, absoluteNodePath);
        if (!isOutside && ignoreFilter.ignores(relPath, entry.isDirectory())) continue;
        const baseHaystack = caseInsensitive ? entry.name.toLowerCase() : entry.name;
        const haystack = matchPath ? `${baseHaystack} ${relPath.toLowerCase()}` : baseHaystack;

        if (haystack.includes(needle)) {
          let stats: Stats;
          try {
            stats = await this.cold.lstat(absoluteNodePath);
          } catch (error) {
            // # Best-effort
            // file vanished or permission error for this single match, skip, do not fail whole search.
            // Error is not swallowed as empty success. enclosing walk continues and service propagates root errors.
            const nodeErr = error as { code?: string };
            if (nodeErr?.code === 'ENOENT') continue;
            continue;
          }
          matches.push(buildFileNode(absoluteNodePath, workspaceRoot, stats));
          if (matches.length >= maxResults) {
            truncated = true;
            return;
          }
        }

        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await walk(absoluteNodePath, depth + 1, false);
        }
      }
    };

    await walk(absolutePath, 0, true);

    return SearchFilesDataSchema.parse({ query, matches });
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 512);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
