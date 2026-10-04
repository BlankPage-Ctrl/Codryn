import type { ShellSegment } from '../types/index.js';
import type { ParseResult } from './parser.js';

/**
 * PowerShell / Windows parser.
 *
 * The POSIX parser in `./parser` assumes bash tokenizing (shell-quote),
 * Unix wrappers (`time`/`nohup`/`nice`), and `$()`/backtick substitution.
 * That mis-models PowerShell: cmdlets are case-insensitive, aliases are
 * pervasive (`dir`/`ls`/`gci`), the escape char is the backtick, and
 * string expansion uses `$var` / `$()` / `${}` outside single quotes.
 *
 * This parser is intentionally fail-closed: anything dynamic (`$`
 * expansion outside single quotes) sets `hasCommandSubst` so the policy
 * forces at least `ask`.
 */

const PS_SEPARATORS = new Set([';', '&&', '||', '|', '&']);

const PS_TRANSPARENT_WRAPPERS = new Set(['powershell', 'pwsh']);

/** Lowercase-only normalization (cmdlets are case-insensitive).
 * Aliases (`dir`, `del`, ...) are kept as typed so policy messages show
 * what the user actually wrote; every alias is listed explicitly in
 * `READONLY_COMMANDS` / `createSecureDefaults()` instead. */
export function isPowerShellShell(shell: string | undefined | null): boolean {
  if (!shell) return false;
  const s = shell.trim().toLowerCase();
  return (
    s === 'pwsh' ||
    s === 'powershell' ||
    s === 'powershell.exe' ||
    s === 'pwsh.exe' ||
    s.endsWith('/pwsh') ||
    s.endsWith('/powershell') ||
    s.endsWith('\\pwsh') ||
    s.endsWith('\\powershell') ||
    s.endsWith('\\pwsh.exe') ||
    s.endsWith('\\powershell.exe') ||
    s === 'cmd' ||
    s === 'cmd.exe'
  );
}

export function normalizePowerShellCmd(cmd: string): string {
  return cmd.toLowerCase();
}

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

/** Split a command line on PowerShell separators, respecting quotes. */
function splitSegments(src: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // PowerShell escapes a quote by doubling it; don't toggle on doubled quotes.
    if (c === "'" && !inDouble) {
      if (src[i + 1] === "'") {
        cur += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      cur += c;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      if (src[i + 1] === '"') {
        cur += '""';
        i += 2;
        continue;
      }
      inDouble = !inDouble;
      cur += c;
      i++;
      continue;
    }
    if (!inSingle && !inDouble) {
      const two = src.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        out.push(cur);
        cur = '';
        i += 2;
        continue;
      }
      if (c === ';' || c === '|' || c === '&') {
        out.push(cur);
        cur = '';
        i++;
        continue;
      }
    }
    cur += c;
    i++;
  }
  if (inSingle || inDouble) return null;
  out.push(cur);
  return out;
}

/** Tokenize one segment, stripping PowerShell quotes. */
function tokenizeSegment(src: string): string[] | null {
  const tokens: string[] = [];
  let cur = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  const flush = () => {
    if (hasToken) {
      tokens.push(cur);
      cur = '';
      hasToken = false;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (inSingle) {
      if (c === "'") {
        if (src[i + 1] === "'") {
          cur += "'";
          i += 2;
          continue;
        }
        inSingle = false;
        i++;
        continue;
      }
      cur += c;
      hasToken = true;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inDouble = false;
        i++;
        continue;
      }
      // Backtick escapes the next char inside double quotes; keep both so the
      // dynamic-value scan still sees `$` after a backtick (escaped = inert).
      cur += c;
      hasToken = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      hasToken = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      hasToken = true;
      i++;
      continue;
    }
    if (c === '`' && i + 1 < src.length) {
      // Backtick escapes next char outside quotes: keep the escaped char literally.
      cur += src[i + 1];
      hasToken = true;
      i += 2;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      // Rest of line is a comment.
      break;
    }
    if (/\s/.test(c)) {
      flush();
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      flush();
      // Collapse >>, 2>, 2>>, *>, >>, >.
      let op = c;
      if (src[i + 1] === '>') {
        op += '>';
        i++;
      }
      tokens.push(op);
      i++;
      continue;
    }
    cur += c;
    hasToken = true;
    i++;
  }
  if (inSingle || inDouble) return null;
  flush();
  return tokens;
}

/**
 * Detect `$` expansion outside single quotes (variables, `$()`, `${}`).
 * A backtick-escaped `$` is inert. Returns null on unbalanced quotes.
 */
function detectDynamicValue(src: string): boolean | null {
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" && !inDouble) {
      if (src[i + 1] === "'") {
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      if (src[i + 1] === '"') {
        i += 2;
        continue;
      }
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (inSingle) {
      i++;
      continue;
    }
    if (c === '`') {
      i += 2;
      continue;
    }
    if (c === '$' && i + 1 < src.length && src[i + 1] !== ' ') {
      return true;
    }
    i++;
  }
  if (inSingle || inDouble) return null;
  return false;
}

function unwrapPowerShellWrappers(args: string[]): string[] {
  // `pwsh -c <cmd>` / `powershell -Command <cmd>` just re-enters a shell;
  // evaluate the inner command instead of the wrapper. (The policy still
  // hard-denies these wrapper forms when typed literally; this unwrap only
  // applies after the parser already split the line.)
  if (
    args.length >= 2 &&
    PS_TRANSPARENT_WRAPPERS.has(args[0].toLowerCase()) &&
    ['-c', '-command', '-commandline'].includes(args[1].toLowerCase())
  ) {
    return args.slice(2);
  }
  return args;
}

export function parsePowerShell(command: string): ParseResult {
  if (hasControlChars(command)) {
    return { ok: false, reason: 'command contains control characters', segments: [] };
  }
  const raws = splitSegments(command);
  if (raws === null) {
    return { ok: false, reason: 'unbalanced quotes', segments: [] };
  }
  const segments: ShellSegment[] = [];
  for (const raw of raws) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const dynamic = detectDynamicValue(trimmed);
    if (dynamic === null) {
      return { ok: false, reason: 'unbalanced quotes', segments: [] };
    }
    const tokens = tokenizeSegment(trimmed);
    if (tokens === null) {
      return { ok: false, reason: 'unbalanced quotes', segments: [] };
    }
    // Separate redirect targets (`> file`, `2> file`) from argv.
    const args: string[] = [];
    const reads: string[] = [];
    const writes: { path: string; mode: 'trunc' | 'append' }[] = [];
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t] as string;
      if (/^\d+$/.test(tok) && (tokens[t + 1] === '>' || tokens[t + 1] === '>>')) continue;
      if (tok === '>' || tok === '>>') {
        const target = tokens[t + 1] as string | undefined;
        if (target !== undefined) {
          writes.push({ path: target, mode: tok === '>>' ? 'append' : 'trunc' });
          t++;
        }
        continue;
      }
      if (tok === '<') {
        const target = tokens[t + 1] as string | undefined;
        if (target !== undefined) {
          reads.push(target);
          t++;
        }
        continue;
      }
      args.push(tok);
    }
    const unwrapped = unwrapPowerShellWrappers(args);
    if (unwrapped.length === 0) continue;
    const cmd = normalizePowerShellCmd(unwrapped[0] as string);
    segments.push({
      cmd,
      args: unwrapped.slice(1),
      reads,
      writes,
      hasCommandSubst: dynamic,
    });
  }
  if (segments.length === 0) {
    return { ok: false, reason: 'no executable command found', segments: [] };
  }
  // Separators that only exist to chain/pipe are rejected as operators when
  // they appear where a command should be (splitSegments already dropped them).
  void PS_SEPARATORS;
  return { ok: true, segments };
}
