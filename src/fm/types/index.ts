import { z } from 'zod';
import type { ErrorCode } from './error-codes.js';

export enum FileType {
  FILE = 'file',
  DIRECTORY = 'directory',
  SYMLINK = 'symlink',
}

export type RelativePath = string;
export type AbsolutePath = string;
export type FmEncoding = 'utf-8' | 'base64';
export type ReadFileInputEncoding = 'utf-8' | 'auto';

export interface FileNode {
  id: string;
  name: string;
  path: RelativePath;
  type: FileType;
  isDirectory: boolean;
  size?: number;
  lastModified?: number;
  hasChildren?: boolean;
  children?: FileNode[];
  meta?: {
    isSymlink?: boolean;
    symlinkTarget?: string;
  };
}

export const FileNodeSchema: z.ZodType<FileNode> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.nativeEnum(FileType),
  isDirectory: z.boolean(),
  size: z.number().optional(),
  lastModified: z.number().optional(),
  hasChildren: z.boolean().optional(),
  children: z.lazy(() => FileNodeSchema.array()).optional(),
  meta: z
    .object({
      isSymlink: z.boolean().optional(),
      symlinkTarget: z.string().optional(),
    })
    .optional(),
});

export interface FmMeta {
  totalNodes?: number;
  requestedPath?: RelativePath;
  workspaceRoot?: AbsolutePath;
}

export interface FmSuccess<T> {
  success: true;
  data: T;
  meta?: FmMeta;
}

export interface FmError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    details?: unknown;
  };
}

export type FmResult<T> = FmSuccess<T> | FmError;

export const ListDirDataSchema = z.object({
  requestedPath: z.string(),
  nodes: FileNodeSchema.array(),
});

export type ListDirData = z.infer<typeof ListDirDataSchema>;

export const GetStatDataSchema = z.object({
  node: FileNodeSchema,
});

export type GetStatData = z.infer<typeof GetStatDataSchema>;

export const ContentLineSchema = z.object({
  line: z.number().int().positive(),
  text: z.string(),
});

export type ContentLine = z.infer<typeof ContentLineSchema>;

export const ReadFileDataSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']),
  size: z.number(),
  truncated: z.boolean(),
  totalLines: z.number().int().nonnegative().optional(),
  contentWithLineNumbers: z.string().optional(),
});

export type ReadFileData = z.infer<typeof ReadFileDataSchema>;

export const SearchFilesDataSchema = z.object({
  query: z.string(),
  matches: FileNodeSchema.array(),
});

export type SearchFilesData = z.infer<typeof SearchFilesDataSchema>;

export interface SearchFilesOptions {
  maxResults?: number;
  maxDepth?: number;
  caseInsensitive?: boolean;
  matchPath?: boolean;
  /** Skip ignore filtering entirely (workspace patterns + defaults). */
  includeIgnored?: boolean;
}

export interface ListDirOptions {
  /** Skip ignore filtering entirely (workspace patterns + defaults). */
  includeIgnored?: boolean;
}

export interface ReadFileOptions {
  maxBytes?: number;
  encoding?: ReadFileInputEncoding;
  withLineNumbers?: boolean;
  startLine?: number;
  endLine?: number;
}

export enum WatchEventType {
  CREATED = 'CREATED',
  DELETED = 'DELETED',
  MODIFIED = 'MODIFIED',
  MOVED = 'MOVED',
}

export interface WatchEvent {
  type: WatchEventType;
  node: FileNode;
  oldPath?: RelativePath;
  timestamp: number;
}
