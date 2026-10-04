import type { RulePattern, ShellSegment } from '../types/index.js';

/**
 * Command-pattern syntax (per-command, space-separated args):
 *   `cmd`         -> cmd alone, no args
 *   `cmd:*`       -> cmd with any args
 *   `cmd a b`     -> cmd with exactly args [a, b]
 *   `cmd a:*`     -> cmd with arg `a` plus any others
 *   `cmd --flag*` -> cmd with an arg starting with `--flag`
 *   `cmd *.log`   -> cmd with an arg ending in `.log`
 *   `*`           -> any command, any args
 */
export function parsePattern(pattern: string): RulePattern {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { cmd: '', parts: [], trailingWildcard: false };

  let trailingWildcard = false;
  const last = tokens[tokens.length - 1];
  if (last.endsWith(':*')) {
    trailingWildcard = true;
    tokens[tokens.length - 1] = last.slice(0, -2);
    if (tokens[tokens.length - 1] === '') tokens.pop();
  } else if (last === '*') {
    trailingWildcard = true;
    tokens.pop();
  }

  const cmd = tokens[0] ?? '*';
  const parts = tokens.slice(1).map(parsePart);

  return { cmd, parts, trailingWildcard };
}

function parsePart(arg: string): string | { prefix: string } | { suffix: string } {
  if (arg.endsWith('*') && arg.length > 1) {
    return { prefix: arg.slice(0, -1) };
  }
  if (arg.startsWith('*') && arg.length > 1) {
    return { suffix: arg.slice(1) };
  }
  return arg;
}

export function matchRule(pattern: RulePattern, seg: Pick<ShellSegment, 'cmd' | 'args'>): boolean {
  if (pattern.cmd === '*' && pattern.parts.length === 0) return true;
  if (pattern.cmd !== seg.cmd) return false;

  const hasPrefixWildcard = pattern.parts.some((p) => typeof p !== 'string');
  if (seg.args.length < pattern.parts.length) return false;
  if (!pattern.trailingWildcard && !hasPrefixWildcard) {
    if (seg.args.length !== pattern.parts.length) return false;
  }

  for (let i = 0; i < pattern.parts.length; i++) {
    const part = pattern.parts[i];
    const arg = seg.args[i];
    if (typeof part === 'string') {
      if (part !== arg) return false;
    } else if ('prefix' in part) {
      if (!arg.startsWith(part.prefix)) return false;
    } else if (!arg.endsWith(part.suffix)) {
      return false;
    }
  }

  return true;
}
