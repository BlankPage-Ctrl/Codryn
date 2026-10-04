import path from 'node:path';
import type {
  GrepData,
  GrepMatch,
  IGrepRepository,
  IGrepStorage,
  GrepSearchInput,
} from '../types/grep.js';
import { GrepDataSchema, GrepMatchSchema } from '../types/grep.js';
import { toRelativePath } from '../utils/path.js';
import { StorageReadError } from '../errors/storage.js';

export class GrepRepository implements IGrepRepository {
  constructor(private readonly cold: IGrepStorage) {}

  async grep(workspaceRoot: string, search: GrepSearchInput): Promise<GrepData> {
    const raw = await this.cold.search(search);

    const matches: GrepMatch[] = raw.matches.map((match) => {
      const parsed = GrepMatchSchema.safeParse({
        path: toWorkspaceRelative(workspaceRoot, search.cwd, match.path),
        line: match.line,
        column: match.column,
        text: match.text,
      });
      if (!parsed.success) {
        throw new StorageReadError('ripgrep returned an invalid match', {
          issues: parsed.error.issues,
        });
      }
      return parsed.data;
    });

    const parsed = GrepDataSchema.safeParse({
      pattern: search.pattern,
      matches,
      truncated: raw.truncated,
    });
    if (!parsed.success) {
      throw new StorageReadError('ripgrep returned invalid data', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }
}

/** `rg` reports `cwd`-relative paths; the domain speaks workspace-relative. */
function toWorkspaceRelative(workspaceRoot: string, cwd: string, reportedPath: string): string {
  const absolute = path.isAbsolute(reportedPath) ? reportedPath : path.resolve(cwd, reportedPath);
  return toRelativePath(workspaceRoot, absolute);
}
