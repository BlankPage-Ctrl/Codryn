import path from 'node:path';
import type { IFileSystem } from '../types/file-system.js';
import { FileNodeSchema, type FileNode } from '../types/index.js';
import {
  GlobDataSchema,
  type GlobData,
  type GlobSearchInput,
  type IGlobRepository,
  type IGlobStorage,
} from '../types/glob.js';
import { buildFileNode } from '../utils/node.js';
import { StorageReadError } from '../errors/storage.js';

export class GlobRepository implements IGlobRepository {
  constructor(
    private readonly cold: IGlobStorage,
    private readonly fileSystem: IFileSystem,
  ) {}

  async glob(workspaceRoot: string, search: GlobSearchInput): Promise<GlobData> {
    const raw = await this.cold.search(search);

    const nodes: FileNode[] = [];
    for (const reported of raw.paths) {
      const relative = reported.startsWith('./') ? reported.slice(2) : reported;
      const absolute = path.resolve(search.cwd, relative);
      let stats;
      try {
        stats = await this.fileSystem.lstat(absolute);
      } catch (error) {
        // File vanished between rg and lstat: expected race, skip.
        if ((error as { code?: string }).code === 'ENOENT') continue;
        throw new StorageReadError('glob could not stat a matched file', {
          path: absolute,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (stats.isDirectory()) continue;
      const symlinkTarget = stats.isSymbolicLink()
        ? await this.fileSystem.readlink(absolute)
        : undefined;
      const parsedNode = FileNodeSchema.safeParse(
        buildFileNode(
          absolute,
          workspaceRoot,
          stats,
          symlinkTarget !== undefined ? { symlinkTarget } : undefined,
        ),
      );
      if (!parsedNode.success) {
        throw new StorageReadError('glob built an invalid file node', {
          path: absolute,
          issues: parsedNode.error.issues,
        });
      }
      nodes.push(parsedNode.data);
    }

    // rg already sorts ascending by mtime; re-sort newest-first so the order is
    // independent of the ripgrep version's tie-breaking.
    const sorted = [...nodes].sort(
      (a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0) || a.name.localeCompare(b.name),
    );

    const parsed = GlobDataSchema.safeParse({
      pattern: search.pattern,
      requestedPath: search.requestedPath,
      nodes: sorted,
      truncated: raw.truncated,
    });
    if (!parsed.success) {
      throw new StorageReadError('glob produced invalid data', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }
}
