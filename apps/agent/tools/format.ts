import {
  EditFailureReasonSchema,
  FileType,
  type CreateFileData,
  type EditFailureDetails,
  type EditFileData,
  type FileNode,
  type GrepData,
  type GrepMatch,
  type ReadFileData,
} from '../../../src/fm/index.js';
import type { HitlRequest } from '../../../src/human-in-the-loop/index.js';
import type { ShellRunData } from '../../../src/shell/index.js';

export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

export const DEFAULT_GLOB_LIMIT = 100;
export const MAX_GLOB_LIMIT = 1000;

/** Dir names hidden from list_files by default (mirrors DEFAULT_IGNORE_PATTERNS). */
export const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git', '.codryn']);

export interface FormatListOptions {
  limit?: number;
  includeIgnored?: boolean;
}

export interface FormatReadOptions {
  startLine?: number;
  endLine?: number;
}

export interface FormatGrepOptions {
  path?: string;
  maxShown?: number;
  outputMode?: 'content' | 'files_with_matches' | 'count';
}

export function humanizeSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0B';
  if (bytes < 1024) return `${Math.trunc(bytes)}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimNum(kb)}kb`;
  const mb = kb / 1024;
  if (mb < 1024) return `${trimNum(mb)}mb`;
  return `${trimNum(mb / 1024)}gb`;
}

function trimNum(n: number): string {
  return n >= 100 ? `${Math.round(n)}` : `${Math.round(n * 10) / 10}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function safeName(name: string): string {
  return name.replace(/`/g, "'");
}

function isDir(node: FileNode): boolean {
  return node.isDirectory || node.type === FileType.DIRECTORY;
}

function isSymlink(node: FileNode): boolean {
  return node.type === FileType.SYMLINK || node.meta?.isSymlink === true;
}

export function formatListDir(
  requestedPath: string,
  nodes: FileNode[],
  opts: FormatListOptions = {},
): string {
  const limit = Math.min(Math.max(1, Math.round(opts.limit ?? DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT);

  const filtered: string[] = [];
  const visible = nodes.filter((node) => {
    if (!opts.includeIgnored && IGNORED_DIR_NAMES.has(node.name)) {
      filtered.push(node.name);
      return false;
    }
    return true;
  });

  const sorted = [...visible].sort((a, b) => {
    const rank = (n: FileNode) => (isSymlink(n) ? 2 : isDir(n) ? 0 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  const total = sorted.length;
  if (total === 0) {
    const suffix = filtered.length > 0 ? ` (${filtered.length} filtered)` : '';
    return `\`${requestedPath}\` — empty${suffix}`;
  }

  const shown = sorted.slice(0, limit);
  const dirs = sorted.filter((n) => isDir(n) && !isSymlink(n)).length;
  const links = sorted.filter(isSymlink).length;
  const files = total - dirs - links;

  const parts = [plural(dirs, 'dir', 'dirs'), plural(files, 'file', 'files')];
  if (links > 0) parts.push(plural(links, 'link', 'links'));
  const head =
    total > shown.length
      ? `\`${requestedPath}\` — ${shown.length} of ${total} shown (${parts.join(', ')})`
      : `\`${requestedPath}\` — ${plural(total, 'entry', 'entries')} (${parts.join(', ')})`;

  const lines = shown.map((node) => {
    const name = safeName(node.name);
    if (isSymlink(node)) {
      const target = node.meta?.symlinkTarget
        ? ` -> \`${safeName(node.meta.symlinkTarget)}\``
        : ' (symlink)';
      return `- \`${name}\`${target}`;
    }
    if (isDir(node)) {
      const empty = node.hasChildren === false ? ' (empty)' : '';
      return `- \`${name}/\`${empty}`;
    }
    const size = typeof node.size === 'number' ? ` (${humanizeSize(node.size)})` : '';
    return `- \`${name}\`${size}`;
  });

  if (total > shown.length) {
    lines.push(`... +${total - shown.length} more (list a subdirectory for the rest)`);
  }
  if (filtered.length > 0) {
    lines.push(
      `_${plural(filtered.length, 'entry', 'entries')} filtered (${filtered.map(safeName).join(', ')})_`,
    );
  }

  return [head, ...lines].join('\n');
}

export interface FormatGlobOptions {
  limit?: number;
  truncated?: boolean;
}

export function formatGlob(
  pattern: string,
  requestedPath: string,
  nodes: FileNode[],
  opts: FormatGlobOptions = {},
): string {
  const limit = Math.min(Math.max(1, Math.round(opts.limit ?? DEFAULT_GLOB_LIMIT)), MAX_GLOB_LIMIT);
  const total = nodes.length;
  const where = requestedPath === '/' ? 'workspace' : `\`${requestedPath}\``;

  if (total === 0) {
    return (
      `No files match "${safeName(pattern)}" in ${where}.\n` +
      '_Patterns use glob syntax: `*` stays within a segment, `**/` recurses (e.g. `**/*.ts`)._'
    );
  }

  const shown = nodes.slice(0, limit);
  const head =
    total > shown.length
      ? `Found ${total} files matching "${safeName(pattern)}" in ${where} — ${shown.length} shown (sorted by modification time, newest first)`
      : `Found ${plural(total, 'file', 'files')} matching "${safeName(pattern)}" in ${where} (sorted by modification time, newest first)`;

  const lines = shown.map((node) => `- \`${safeName(node.path)}\``);

  if (total > shown.length || opts.truncated === true) {
    lines.push('... more results (refine the pattern or narrow `path`)');
  }

  return [head, ...lines].join('\n');
}

export function formatReadFile(data: ReadFileData, opts: FormatReadOptions = {}): string {
  const path = data.path;
  if (data.encoding !== 'utf-8') {
    const size = typeof data.size === 'number' ? `, ${humanizeSize(data.size)}` : '';
    const head = `# \`${path}\` (base64${size})`;
    const tail = data.truncated ? '\n_(truncated, binary content)_' : '';
    return `${head}\n\`\`\`\n${data.content}\n\`\`\`${tail}`;
  }

  const content = data.contentWithLineNumbers ?? data.content;
  const total = data.totalLines ?? countLines(content);
  const start = opts.startLine ?? 1;
  const end = opts.endLine ?? total;
  const head = `# \`${path}\` — lines ${start}–${end} of ${total}`;
  const tail = data.truncated ? `\n_(truncated, use startLine=${end + 1} to continue)_` : '';
  return `${head}\n\`\`\`\n${content}\n\`\`\`${tail}`;
}

export function formatGrep(data: GrepData, opts: FormatGrepOptions = {}): string {
  const root = opts.path ?? '.';
  const outputMode = opts.outputMode ?? 'content';
  const total = data.matches.length;
  if (total === 0) {
    return (
      `\`${root}\` — no matches for "${safeName(data.pattern)}"\n` +
      '_Try a simpler pattern, `regex: false` for literal text, or widen `path`/`include`._'
    );
  }

  const maxShown =
    opts.maxShown != null && Number.isFinite(opts.maxShown) && opts.maxShown > 0
      ? Math.trunc(opts.maxShown)
      : total;
  const shown = data.matches.slice(0, maxShown);

  const byFile = new Map<string, GrepMatch[]>();
  for (const match of shown) {
    const group = byFile.get(match.path);
    if (group) group.push(match);
    else byFile.set(match.path, [match]);
  }
  // Per-file counts cover all matches (not just the shown slice) so the
  // files/count modes stay accurate even when content is capped.
  const totalByFile = new Map<string, number>();
  for (const match of data.matches) {
    totalByFile.set(match.path, (totalByFile.get(match.path) ?? 0) + 1);
  }
  const fileCount = totalByFile.size;

  if (outputMode === 'files_with_matches') {
    const head =
      total > shown.length
        ? `# grep "${safeName(data.pattern)}" — ${byFile.size} of ${fileCount} files shown (${plural(total, 'match', 'matches')})`
        : `# grep "${safeName(data.pattern)}" — ${plural(fileCount, 'file', 'files')} (${plural(total, 'match', 'matches')})`;
    const lines: string[] = [head];
    for (const [filePath, matches] of byFile) {
      const n = totalByFile.get(filePath) ?? matches.length;
      lines.push(`- \`${safeName(filePath)}\` (${plural(n, 'match', 'matches')})`);
    }
    if (total > shown.length) {
      lines.push(`... +${total - shown.length} more (narrow path/include or raise maxResults)`);
    }
    if (data.truncated) {
      lines.push('_(truncated at source, refine the pattern or narrow path/include)_');
    }
    return lines.join('\n');
  }

  if (outputMode === 'count') {
    const head = `# grep "${safeName(data.pattern)}" — ${plural(total, 'occurrence', 'occurrences')} across ${plural(fileCount, 'file', 'files')}`;
    const lines: string[] = [head];
    for (const [filePath, matches] of byFile) {
      const n = totalByFile.get(filePath) ?? matches.length;
      lines.push(`- \`${safeName(filePath)}\`: ${n}`);
    }
    if (total > shown.length) {
      lines.push(`... +${total - shown.length} more (narrow path/include or raise maxResults)`);
    }
    if (data.truncated) {
      lines.push('_(truncated at source, refine the pattern or narrow path/include)_');
    }
    return lines.join('\n');
  }

  const head =
    total > shown.length
      ? `# grep "${safeName(data.pattern)}" — ${shown.length} of ${total} shown`
      : `# grep "${safeName(data.pattern)}" — ${plural(total, 'match', 'matches')}`;

  const lines: string[] = [head];
  for (const [filePath, matches] of byFile) {
    lines.push(`## \`${safeName(filePath)}\``);
    for (const match of matches) {
      lines.push(`- L${match.line}:C${match.column}: \`${safeName(match.text)}\``);
    }
  }

  if (total > shown.length) {
    lines.push(`... +${total - shown.length} more (narrow path/include or raise maxResults)`);
  }
  if (data.truncated) {
    lines.push('_(truncated at source, refine the pattern or narrow path/include)_');
  }
  return lines.join('\n');
}

export function formatGrepError(code: string, message: string, path?: string): string {
  const head = `**Error**: \`${code}\` — ${message}`;
  const where = path != null && path !== '' ? `\n**Path**: \`${safeName(path)}\`` : '';
  if (code === 'INVALID_INPUT') {
    return `${head}${where}\n**Suggestion**: The pattern is not a valid regex. Fix the syntax, or retry with \`regex: false\` to search it as literal text.`;
  }
  if (code === 'PATH_TRAVERSAL') {
    return `${head}${where}\n**Suggestion**: Path escapes the workspace root. Use a relative path inside the project (e.g. "src/").`;
  }
  if (code === 'PATH_NOT_FOUND') {
    return `${head}${where}\n**Suggestion**: The search root does not exist. Use \`list_files\` to inspect the workspace structure.`;
  }
  return `${head}${where}\n**Suggestion**: Narrow \`path\`/\`include\` and retry. Use \`list_files\` to verify paths.`;
}

function countLines(s: string): number {
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

export function formatToolError(code: string, message: string, path?: string): string {
  const where = path ? ` ('${path}')` : '';
  return `Error [${code}]: ${message}${where}`;
}

export function formatSkillNotFound(name: string, available: string[]): string {
  const head = `**Error**: \`SKILL_NOT_FOUND\` — Skill "${safeName(name)}" not found.`;
  if (available.length === 0) {
    return (
      `${head}\n**Suggestion**: No skills are currently available. ` +
      'The user might have deleted the skill, or perhaps it simply doesnt exist anymore.'
    );
  }
  const list = available.map((n) => `\`${safeName(n)}\``).join(', ');
  return `${head}\n**Suggestion**: Call \`skill\` with one of the available names: ${list}. `;
}

export function formatEditFile(data: EditFileData): string {
  const head = `# Success ${plural(data.appliedEdits, 'edit', 'edits')} \`${data.path}\` applied (${data.totalLines} lines)`;
  const diff =
    data.diff != null && data.diff.trim() !== ''
      ? `\n\`\`\`diff\n${data.diff}\n\`\`\``
      : '\n_(no visible changes)_';
  const tail =
    data.diffTruncated === true
      ? '\n_(diff truncated, use read_file to view the full result)_'
      : '';
  return `${head}${diff}${tail}`;
}

export function formatCreateFile(data: CreateFileData): string {
  const head = `# Success creating \`${data.path}\` with (${data.totalLines} ${data.totalLines === 1 ? 'line' : 'lines'}, ${humanizeSize(data.size)})`;
  const body =
    data.contentWithLineNumbers != null && data.contentWithLineNumbers !== ''
      ? `\n\`\`\`\n${data.contentWithLineNumbers}\n\`\`\``
      : data.content !== ''
        ? `\n\`\`\`\n${data.content}\n\`\`\``
        : '\n_(empty file)_';
  return `${head}${body}`;
}

export function formatCreateFailure(code: string, message: string, path?: string): string {
  const head = `**Error**: \`${code}\` — ${message}`;
  const where = path != null && path !== '' ? `\n**Path**: \`${path}\`` : '';
  if (code === 'ALREADY_EXISTS') {
    return `${head}${where}\n**Suggestion**: File already exists. Use \`edit_file\` to modify it, or retry with \`overwrite: true\` to replace it. Verify with \`list_files\` or \`read_file\`.`;
  }
  if (code === 'PATH_TRAVERSAL') {
    return `${head}${where}\n**Suggestion**: Path escapes workspace root. Use a relative path inside the project (e.g. "src/foo.ts").`;
  }
  return `${head}${where}\n**Suggestion**: Verify the path is relative to project root and content is within 200k chars. Use \`list_files\` to inspect parent directory.`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Math.round((ms / 1000) * 10) / 10}s`;
}

function inlineCode(value: string): string {
  return value.replace(/`/g, "'").replace(/\r?\n/g, ' ');
}

function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function formatStream(label: string, content: string): string {
  const body = content.replace(/\r?\n+$/, '');
  const fence = fenceFor(body);
  return `## ${label}\n${fence}text\n${body}\n${fence}`;
}

export function formatRunShell(data: ShellRunData): string {
  const meta = [
    `- Exit code: ${data.exitCode}`,
    `- Duration: ${formatDuration(data.durationMs)}`,
    `- CWD: \`${inlineCode(data.cwd)}\``,
    ...(data.timedOut ? ['- Timed out: yes'] : []),
    ...(data.signal ? [`- Signal: \`${inlineCode(data.signal)}\``] : []),
  ];

  const blocks = [`# Shell: \`${inlineCode(data.command)}\``, meta.join('\n')];
  const hasStdout = data.stdout.trim().length > 0;
  const hasStderr = data.stderr.trim().length > 0;

  if (hasStdout) blocks.push(formatStream('stdout', data.stdout));
  if (hasStderr) blocks.push(formatStream('stderr', data.stderr));
  if (!hasStdout && !hasStderr) blocks.push('_(no output)_');

  if (data.truncated) {
    blocks.push(
      data.spillPath
        ? `_(output truncated; full output at \`${inlineCode(data.spillPath)}\`)_`
        : '_(output truncated)_',
    );
  }

  return blocks.join('\n\n');
}

export function formatShellError(code: string, message: string): string {
  const head = `**Error**: \`${code}\` - ${message}`;
  switch (code) {
    case 'REQUIRES_APPROVAL':
      return `${head}\n**Suggestion**: This command needs human approval. Ask the user to approve it, or choose a command allowed by policy.`;
    case 'PERMISSION_DENIED':
      return `${head}\n**Suggestion**: The command was blocked by the shell policy. Use an allowed command or ask the user to update the policy.`;
    case 'SHELL_KILLED':
      return `${head}\n**Suggestion**: Execution was stopped by the user. Do not retry unless the user asks.`;
    case 'NOT_ENABLED':
      return `${head}\n**Suggestion**: Shell execution is disabled for this workspace.`;
    case 'PATH_TRAVERSAL':
      return `${head}\n**Suggestion**: The working directory escapes the workspace. Use a path inside the workspace.`;
    case 'PARSE_FAILED':
      return `${head}\n**Suggestion**: The command could not be parsed. Simplify the command and retry.`;
    default:
      return `${head}\n**Suggestion**: Check the command and environment, then retry once.`;
  }
}

function isEditFailureDetails(value: unknown): value is EditFailureDetails {
  if (value === null || typeof value !== 'object') return false;
  const reason = (value as { reason?: unknown }).reason;
  return (
    typeof reason === 'string' &&
    (EditFailureReasonSchema.options as readonly string[]).includes(reason)
  );
}

function formatMatches(matches: EditFailureDetails['matches'], maxShown = 8): string {
  const shown = matches.slice(0, maxShown).map((m) => `- line ${m.line}: \`${m.preview}\``);
  if (matches.length > maxShown) {
    shown.push(`- ... +${matches.length - maxShown} more matches`);
  }
  return shown.join('\n');
}

export function formatEditFailure(
  code: string,
  message: string,
  details?: unknown,
  path?: string,
): string {
  const head = `**Error**: \`${code}\` — ${message}`;
  const where = path != null && path !== '' ? `\n**Path**: \`${path}\`` : '';

  if (!isEditFailureDetails(details)) {
    return `${head}${where}\n**Suggestion**: Verify the file path is relative to the project root (use list_files) and that each edit block follows the SEARCH/REPLACE format.`;
  }

  const block = `block ${details.editIndex + 1} of ${details.totalEdits}`;
  switch (details.reason) {
    case 'NOT_FOUND':
      return (
        `${head}${where}\n**Location**: ${block}\n` +
        `**Code**: \`${details.searchPreview}\`\n` +
        `**Cause**: SEARCH text was not found. The file content may be stale.\n` +
        `**Suggestion**: Re-read the file with read_file, then send SEARCH text copied exactly from it.`
      );
    case 'AMBIGUOUS':
    case 'AMBIGUOUS_IN_HINT':
      return (
        `${head}${where}\n**Location**: ${block}\n` +
        `**Code**: \`${details.searchPreview}\`\n` +
        `**Cause**: SEARCH text matches ${details.matches.length} locations.\n` +
        `${formatMatches(details.matches)}\n` +
        `**Suggestion**: Add a \`lines <start>[-<end>]\` hint after SEARCH pointing at one of the locations above.`
      );
    case 'NOT_FOUND_IN_HINT': {
      const range =
        details.expandedRange != null
          ? `lines ${details.expandedRange.start}–${details.expandedRange.end}`
          : 'the hinted range';
      const outside = details.allMatchesOutsideHint ?? [];
      const found =
        outside.length > 0 ? `\nFound outside the hint:\n${formatMatches(outside)}` : '';
      return (
        `${head}${where}\n**Location**: ${block}\n` +
        `**Code**: \`${details.searchPreview}\`\n` +
        `**Cause**: SEARCH text exists but not within ${range}.${found}\n` +
        `**Suggestion**: Fix the \`lines\` hint to one of the locations above, or drop the hint.`
      );
    }
    case 'OVERLAP': {
      const other =
        details.overlappingWith != null ? `block ${details.overlappingWith + 1}` : 'another block';
      return (
        `${head}${where}\n**Location**: ${block}\n` +
        `**Code**: \`${details.searchPreview}\`\n` +
        `**Cause**: This block overlaps with ${other}.\n` +
        `**Suggestion**: Merge the overlapping blocks into one, or split them into separate edit_file calls.`
      );
    }
    default:
      return `${head}${where}`;
  }
}

export function formatHitlError(code: string, message: string, suggestion?: string): string {
  const head = `**Error**: \`${code}\` — ${message}`;
  return suggestion ? `${head}\n**Suggestion**: ${suggestion}` : head;
}

export type SubAgentErrorCode =
  | 'UNKNOWN_AGENT'
  | 'CHILD_TIMEOUT'
  | 'CHILD_ABORTED'
  | 'CHILD_FAILED';

export function formatSubAgentError(
  code: SubAgentErrorCode,
  message: string,
  available: string[] = [],
): string {
  const head = `**Error**: \`${code}\` — ${message}`;
  if (code === 'UNKNOWN_AGENT') {
    if (available.length === 0) {
      return `${head}\n**Suggestion**: No sub-agents are currently available.`;
    }
    const list = available.map((n) => `\`${safeName(n)}\``).join(', ');
    return `${head}\n**Suggestion**: Call \`delegate_task\` with one of the available names: ${list}.`;
  }
  if (code === 'CHILD_TIMEOUT') {
    return (
      `${head}\n**Suggestion**: The child ran out of time. Retry with a smaller task, ` +
      'or raise `timeoutMs` in its `.codryn/agents/*.md` file.'
    );
  }
  if (code === 'CHILD_ABORTED') {
    return `${head}\n**Suggestion**: The run was cancelled. Do not retry the delegation.`;
  }
  return (
    `${head}\n**Suggestion**: Retry with a smaller self-contained task, ` +
    'or handle it directly with your own tools.'
  );
}

export function formatHitlResult(request: HitlRequest): string {
  const header = `# HITL \`${request.type}\` — ${request.status} — "${request.title.replace(/`/g, "'")}"`;
  const meta = [
    `- Request: \`${request.id}\``,
    request.description ? `- Description: ${request.description}` : null,
    request.expiresAt ? `- Expires: \`${request.expiresAt.toISOString()}\`` : null,
    request.resolvedAt ? `- Resolved: \`${request.resolvedAt.toISOString()}\`` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const payloadPreview =
    request.payload &&
    typeof request.payload === 'object' &&
    Object.keys(request.payload as Record<string, unknown>).length > 0
      ? `\n**Payload**:\n\`\`\`json\n${JSON.stringify(request.payload, null, 2)}\n\`\`\``
      : '';

  if (!request.response) {
    return [header, meta, payloadPreview].filter(Boolean).join('\n\n') + '\n\n_(no response yet)_';
  }

  const resp = request.response as Record<string, unknown>;
  let body: string;
  if (request.type === 'approval') {
    const outcome = String(resp.outcome ?? 'unknown');
    const reason = resp.reason ? `\n- Reason: ${String(resp.reason)}` : '';
    const mod = resp.modificationNote ? `\n- Modification: ${String(resp.modificationNote)}` : '';
    body = `**Human response**: \`${outcome}\`${reason}${mod}`;
  } else if (request.type === 'ask') {
    body = `**Human answer**:\n\`\`\`\n${String(resp.value ?? JSON.stringify(resp))}\n\`\`\``;
  } else if (request.type === 'choice') {
    const sel = Array.isArray(resp.selected)
      ? (resp.selected as string[]).map((s) => `\`${s}\``).join(', ')
      : JSON.stringify(resp.selected);
    const custom = resp.customInput ? `\n- Custom: ${String(resp.customInput)}` : '';
    body = `**Human choice**: ${sel}${custom}`;
  } else {
    body = `**Human response**:\n\`\`\`json\n${JSON.stringify(resp, null, 2)}\n\`\`\``;
  }

  return [header, meta, payloadPreview, body].filter(Boolean).join('\n\n');
}
