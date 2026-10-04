import type {
  CreateFileData,
  EditFileData,
  FileNode,
  ListDirData,
  ReadFileData,
} from '../../../src/fm/index.js';
import type { ShellRunData } from '../../../src/shell/index.js';
import type { HitlRequest } from '../../../src/human-in-the-loop/index.js';

export interface ListFilesRichBody {
  toolCallId: string;
  requestedPath: string;
  nodes: FileNode[];
  total: number;
  limit?: number;
}

export interface ReadFileRichBody {
  toolCallId: string;
  path: string;
  content: string;
  contentWithLineNumbers?: string;
  encoding: ReadFileData['encoding'];
  size: number;
  truncated: boolean;
  totalLines?: number;
}

export interface EditFileRichBody {
  toolCallId: string;
  path: string;
  appliedEdits: number;
  content: string;
  contentWithLineNumbers?: string;
  encoding: EditFileData['encoding'];
  size: number;
  totalLines: number;
  diff?: string;
  diffTruncated?: boolean;
}

export interface CreateFileRichBody {
  toolCallId: string;
  path: string;
  content: string;
  contentWithLineNumbers?: string;
  encoding: CreateFileData['encoding'];
  size: number;
  totalLines: number;
}

export interface RunShellRichBody {
  toolCallId: string;
  executionId: string;
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutAnsi: string;
  stderrAnsi: string;
  truncated: boolean;
  spillPath: string | null;
  durationMs: number;
  timedOut: boolean;
  signal: string | null;
}

export interface HitlRichBody {
  toolCallId: string;
  requestId: string;
  type: HitlRequest['type'];
  title: string;
  description: string | null;
  status: HitlRequest['status'];
  payload: HitlRequest['payload'];
  response: HitlRequest['response'];
  createdAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
}

/**
 * Out-of-band tool payload. Never enters the model input - the tool's text
 * return value is the only thing the model sees. The body is persisted onto
 * the tool part row (`dataJson`) and forwarded to the frontend feed.
 */
export interface RichToolResult {
  toolCallId: string;
  implement: string;
  body: unknown;
}

export type OnRichResult = (result: RichToolResult) => void;

export function toListFilesRichBody(
  toolCallId: string,
  data: ListDirData,
  opts?: { limit?: number },
): ListFilesRichBody {
  return {
    toolCallId,
    requestedPath: data.requestedPath,
    nodes: data.nodes,
    total: data.nodes.length,
    ...(opts?.limit != null ? { limit: opts.limit } : {}),
  };
}

export function toReadFileRichBody(toolCallId: string, data: ReadFileData): ReadFileRichBody {
  return {
    toolCallId,
    path: data.path,
    content: data.content,
    ...(data.contentWithLineNumbers != null
      ? { contentWithLineNumbers: data.contentWithLineNumbers }
      : {}),
    encoding: data.encoding,
    size: data.size,
    truncated: data.truncated,
    ...(data.totalLines != null ? { totalLines: data.totalLines } : {}),
  };
}

export function toEditFileRichBody(toolCallId: string, data: EditFileData): EditFileRichBody {
  return {
    toolCallId,
    path: data.path,
    appliedEdits: data.appliedEdits,
    content: data.content,
    ...(data.contentWithLineNumbers != null
      ? { contentWithLineNumbers: data.contentWithLineNumbers }
      : {}),
    encoding: data.encoding,
    size: data.size,
    totalLines: data.totalLines,
    ...(data.diff != null ? { diff: data.diff } : {}),
    ...(data.diffTruncated != null ? { diffTruncated: data.diffTruncated } : {}),
  };
}

export function toCreateFileRichBody(toolCallId: string, data: CreateFileData): CreateFileRichBody {
  return {
    toolCallId,
    path: data.path,
    content: data.content,
    ...(data.contentWithLineNumbers != null
      ? { contentWithLineNumbers: data.contentWithLineNumbers }
      : {}),
    encoding: data.encoding,
    size: data.size,
    totalLines: data.totalLines,
  };
}

export function toRunShellRichBody(
  toolCallId: string,
  executionId: string,
  data: ShellRunData,
): RunShellRichBody {
  return {
    toolCallId,
    executionId,
    command: data.command,
    cwd: data.cwd,
    exitCode: data.exitCode,
    stdout: data.stdout,
    stderr: data.stderr,
    stdoutAnsi: data.stdoutAnsi,
    stderrAnsi: data.stderrAnsi,
    truncated: data.truncated,
    spillPath: data.spillPath,
    durationMs: data.durationMs,
    timedOut: data.timedOut,
    signal: data.signal,
  };
}

export function toHitlRichBody(toolCallId: string, request: HitlRequest): HitlRichBody {
  return {
    toolCallId,
    requestId: request.id,
    type: request.type,
    title: request.title,
    description: request.description,
    status: request.status,
    payload: request.payload,
    response: request.response,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt ? request.expiresAt.toISOString() : null,
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
  };
}
