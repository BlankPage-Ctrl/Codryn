import { z } from 'zod';
import type { FmResult } from './index.js';

/**
 * Single content match. `line` and `column` are 1-based.
 * Sourced from `rg --json` (`line_number` + `lines.text` + first submatch
 * offset), so no `ReadFileService` round-trip is needed to show the code.
 */
export const GrepMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
});

export type GrepMatch = z.infer<typeof GrepMatchSchema>;

export const GrepDataSchema = z.object({
  pattern: z.string(),
  matches: GrepMatchSchema.array(),
  truncated: z.boolean(),
});

export type GrepData = z.infer<typeof GrepDataSchema>;

export const GrepOptionsSchema = z.object({
  /** `true` (default): pattern is a regex. `false`: literal fixed string. */
  regex: z.boolean().optional(),
  /** Default `true`, mirroring `SearchFilesOptions`. */
  caseInsensitive: z.boolean().optional(),
  /** Allowlist of workspace-relative files. AND-combined with `folders`. */
  files: z.array(z.string().min(1).max(1000)).max(500).optional(),
  /** Workspace-relative search roots. Defaults to `requestedPath`. */
  folders: z.array(z.string().min(1).max(1000)).max(100).optional(),
  /** Restrict searched files by glob, e.g. `*.ts`. Passed as `rg --glob`. */
  include: z.array(z.string().min(1).max(500)).max(100).optional(),
  /** Skip ignore filtering entirely (workspace patterns + defaults). */
  includeIgnored: z.boolean().optional(),
  maxResults: z.number().int().positive().max(10000).optional(),
  /** Passed as `rg --max-filesize`, e.g. `1M`, `500K`, or bare bytes. */
  maxFileSize: z
    .string()
    .regex(/^\d+[KMG]?$/i)
    .max(20)
    .optional(),
  timeoutMs: z.number().int().positive().max(120000).optional(),
});

export type GrepOptions = z.infer<typeof GrepOptionsSchema>;

/** Raw single match from cold storage. `path` is relative to `cwd`. */
export interface RawGrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

/** Paths are `cwd`-relative, `cwd` absolute. */
export interface GrepSearchInput {
  cwd: string;
  pattern: string;
  paths: string[];
  fixedStrings: boolean;
  caseInsensitive: boolean;
  globs: string[];
  ignoreGlobs: string[];
  respectIgnoreFiles: boolean;
  maxFileSize?: string;
  maxResults: number;
  timeoutMs: number;
}

export interface GrepSearchResult {
  matches: RawGrepMatch[];
  truncated: boolean;
}

export interface IGrepStorage {
  search(input: GrepSearchInput): Promise<GrepSearchResult>;
}

export interface IGrepRepository {
  grep(workspaceRoot: string, search: GrepSearchInput): Promise<GrepData>;
}

export interface IGrepService {
  grep(requestedPath: string, pattern: string, opts?: GrepOptions): Promise<FmResult<GrepData>>;
}
