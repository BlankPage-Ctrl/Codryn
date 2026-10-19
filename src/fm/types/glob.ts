import { z } from 'zod';
import { FileNodeSchema, type FmResult } from './index.js';

/**
 * Result of a glob over the workspace. `nodes` mirrors `ListDirData.nodes`
 * (full `FileNode`) so consumers can reuse the same formatters/UI, but only
 * files are returned, ordered by modification time (newest first).
 */
export const GlobDataSchema = z.object({
  pattern: z.string(),
  requestedPath: z.string(),
  nodes: FileNodeSchema.array(),
  truncated: z.boolean(),
});

export type GlobData = z.infer<typeof GlobDataSchema>;

export const GlobOptionsSchema = z.object({
  pattern: z.string().min(1).max(1000),
  maxResults: z.number().int().positive().max(10000).optional(),
  includeIgnored: z.boolean().optional(),
});

export type GlobOptions = z.infer<typeof GlobOptionsSchema>;

export interface RawGlobResult {
  paths: string[];
  truncated: boolean;
}

/** Paths are `cwd`-relative, `cwd` absolute. */
export interface GlobSearchInput {
  cwd: string;
  /** `cwd`-relative search root (`.` for the workspace root). */
  path: string;
  requestedPath: string;
  pattern: string;
  /** Extra include globs, AND-combined with `pattern`. Reserved for callers. */
  includeGlobs: string[];
  ignoreGlobs: string[];
  respectIgnoreFiles: boolean;
  maxResults: number;
  timeoutMs: number;
}

export interface IGlobStorage {
  search(input: GlobSearchInput): Promise<RawGlobResult>;
}

export interface IGlobRepository {
  glob(workspaceRoot: string, search: GlobSearchInput): Promise<GlobData>;
}

export interface IGlobService {
  glob(requestedPath: string, opts: GlobOptions): Promise<FmResult<GlobData>>;
}
