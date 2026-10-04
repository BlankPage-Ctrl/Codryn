/**
 * FM-backed code reader for insight renderers.
 *
 * Replaces srcinsight `readDisk(root, rel)` with `ReadFileService`
 * (via `buildFmServices`). The critical rule lives here:
 *
 * - NEVER call `confirm()` / `abort()` on a pending approval. An
 *   `isFmPendingApproval()` outcome means the path is outside the
 *   workspace: no FS access has happened yet, and the renderer must NOT
 *   trigger HITL. It only marks the file with a manual read_file pointer.
 */

import type { ReadFileData, ReadFileOptions } from '../../../../src/fm/index.js';
import { type FmOutcome, isFmPendingApproval } from '../../../../src/fm/types/permission.js';
import { escTick, safeName } from '../shared.js';

export interface RenderCodeReader {
  readFile(requestedPath: string, opts?: ReadFileOptions): Promise<FmOutcome<ReadFileData>>;
}

export type FileLoad =
  | { kind: 'ok'; lines: string[]; totalLines: number; data: ReadFileData }
  | { kind: 'outside'; absolutePath: string; requestedPath: string }
  | { kind: 'stale'; reason: 'missing' | 'line-shifted' };

function splitRawLines(content: string): string[] {
  if (content === '') return [];
  const raw = content.split('\n');
  if (content.endsWith('\n') && raw[raw.length - 1] === '') raw.pop();
  return raw;
}

/**
 * Load raw source lines for slicing. `indexedEnd` is the max indexed line
 * for this file; a disk file that shrank below it shifted - slicing would
 * show the wrong code, so report stale instead.
 *
 * Outside-workspace (`REQUIRES_APPROVAL`) returns `{kind:'outside'}` and
 * never touches `confirm()` - no HITL is triggered.
 */
export async function loadForRender(
  reader: RenderCodeReader,
  relPath: string,
  indexedEnd: number,
): Promise<FileLoad> {
  let outcome: FmOutcome<ReadFileData>;
  try {
    outcome = await reader.readFile(relPath, { withLineNumbers: false });
  } catch {
    return { kind: 'stale', reason: 'missing' };
  }
  if (isFmPendingApproval(outcome)) {
    return {
      kind: 'outside',
      absolutePath: outcome.permission.absolutePath,
      requestedPath: outcome.permission.requestedPath,
    };
  }
  if (!outcome.success) return { kind: 'stale', reason: 'missing' };
  const data = outcome.data;
  if (data.encoding !== 'utf-8') return { kind: 'stale', reason: 'missing' };
  const lines = splitRawLines(data.content);
  const total = data.totalLines ?? lines.length;
  if (indexedEnd > lines.length) return { kind: 'stale', reason: 'line-shifted' };
  return { kind: 'ok', lines, totalLines: total, data };
}

/**
 * Placeholder for a codeblock that cannot be rendered because it lives
 * outside the workspace. Points at manual `read_file` instead of HITL.
 */
export function formatOutsideNotice(requestedPath: string, start: number, end: number): string {
  return `_cannot render codeblock — outside workspace, use read_file manually at \`${safeName(requestedPath)}\` ${start}:${end}_`;
}

/** Compact section for an outside-workspace file (trace/search code list). */
export function formatOutsideSection(
  requestedPath: string,
  start: number,
  end: number,
  absolutePath?: string,
): string {
  const where = absolutePath ? ` (\`${escTick(absolutePath)}\`)` : '';
  return `# \`${safeName(requestedPath)}\`${where}\n${formatOutsideNotice(requestedPath, start, end)}`;
}
