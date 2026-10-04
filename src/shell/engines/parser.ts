import { parse as parseShellQuote, type ParseEntry } from 'shell-quote';
import type { ShellSegment } from '../types/index.js';
import { isPowerShellShell, parsePowerShell } from './powershell.js';

export interface ParseResult {
  ok: boolean;
  reason?: string;
  segments: ShellSegment[];
}

const COMMAND_SEPS = new Set(['&&', '||', ';', '|', '|&', '&', '(', ')']);
const REDIRECT_OPS = new Set(['<', '>', '>>', '>&', '<&']);
const TRANSPARENT_WRAPPERS = new Set(['time', 'nohup', 'nice', 'command', 'ionice']);

const HEREDOC_RE = /<<-?\s*['"]?\w+/;
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a shell command line into policy-evaluable segments.
 *
 * - bash/sh (default): mirrors how bash tokenizes input (quotes removed,
 *   operators split). Chained commands (`&&`, `||`, `;`, `|`, `&`,
 *   subshells) are evaluated independently so a single allow rule can
 *   never carry a hidden destructive segment.
 * - pwsh/powershell/cmd: dispatches to the PowerShell parser
 *   (`./powershell`), which normalizes case-insensitive cmdlets/aliases
 *   and flags `$` expansion as dynamic. Pass `{ shell }` from
 *   `GlobalShellConfig.shell` so policy sees the right segments.
 */
export function parseShell(command: string, opts?: { shell?: string }): ParseResult {
  if (opts?.shell && isPowerShellShell(opts.shell)) {
    return parsePowerShell(command);
  }
  if (hasControlChars(command)) {
    return { ok: false, reason: 'command contains control characters', segments: [] };
  }
  if (HEREDOC_RE.test(command)) {
    return { ok: false, reason: 'heredocs are not supported', segments: [] };
  }

  const hasCommandSubst = detectCommandSubstitution(command);
  if (hasCommandSubst === null) {
    return { ok: false, reason: 'unbalanced quotes', segments: [] };
  }

  let tokens: ParseEntry[];
  try {
    tokens = parseShellQuote(command) as ParseEntry[];
  } catch (err) {
    return { ok: false, reason: `tokenize failed: ${(err as Error).message}`, segments: [] };
  }

  const segments = buildSegments(tokens, hasCommandSubst);
  if (segments.length === 0) {
    return { ok: false, reason: 'no executable command found', segments: [] };
  }
  return { ok: true, segments };
}

/** Scan for `$()` and backticks outside single quotes; null on unbalanced quotes. */
function detectCommandSubstitution(command: string): boolean | null {
  let inSingle = false;
  let inDouble = false;
  let found = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle) continue;
    if (c === '`') found = true;
    if (c === '$' && command[i + 1] === '(') found = true;
  }

  if (inSingle || inDouble) return null;
  return found;
}

function buildSegments(tokens: ParseEntry[], hasCommandSubst: boolean): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let current: ParseEntry[] = [];

  const flush = () => {
    const seg = segmentFromTokens(current);
    if (seg) segments.push({ ...seg, hasCommandSubst });
    current = [];
  };

  for (const token of tokens) {
    if (typeof token === 'object' && 'op' in token && COMMAND_SEPS.has(token.op)) {
      flush();
      continue;
    }
    current.push(token);
  }
  flush();
  return segments;
}

function segmentFromTokens(tokens: ParseEntry[]): ShellSegment | undefined {
  const args: string[] = [];
  const reads: string[] = [];
  const writes: { path: string; mode: 'trunc' | 'append' }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (typeof token === 'string') {
      if (/^\d+$/.test(token) && isRedirectOp(tokens[i + 1])) continue; // fd prefix
      args.push(token);
      continue;
    }

    if ('comment' in token) continue;
    if ('pattern' in token) {
      args.push(token.pattern);
      continue;
    }
    if ('op' in token) {
      if (REDIRECT_OPS.has(token.op)) {
        const target = tokens[i + 1];
        if (typeof target !== 'string') continue;
        i++;
        if (token.op === '>' || token.op === '>>') {
          writes.push({ path: target, mode: token.op === '>>' ? 'append' : 'trunc' });
        } else if (token.op === '<') {
          reads.push(target);
        }
      }
      continue;
    }
  }

  const unwrapped = unwrapWrappers(args);
  if (unwrapped.length === 0) return undefined;
  return { cmd: unwrapped[0], args: unwrapped.slice(1), reads, writes, hasCommandSubst: false };
}

function isRedirectOp(token: ParseEntry | undefined): boolean {
  return typeof token === 'object' && token !== null && 'op' in token && REDIRECT_OPS.has(token.op);
}

/**
 * Strip transparent wrappers (`time nohup ls`) and `env KEY=1 cmd` so the
 * policy evaluates the real command. A bare `env` stays `env` (read-only).
 */
function unwrapWrappers(args: string[]): string[] {
  let idx = 0;
  while (idx < args.length) {
    const arg = args[idx];
    if (TRANSPARENT_WRAPPERS.has(arg)) {
      idx++;
      continue;
    }
    if (arg === 'env') {
      let j = idx + 1;
      while (j < args.length && ENV_ASSIGN_RE.test(args[j])) j++;
      if (j >= args.length) break; // bare `env` — keep it
      return args.slice(j);
    }
    break;
  }
  return args.slice(idx);
}
