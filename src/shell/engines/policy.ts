import type {
  PolicyDecision,
  SegmentDecision,
  ShellSegment,
  TerminalPolicy,
  Verdict,
} from '../types/index.js';
import { matchRule, parsePattern } from './rules.js';
import { READONLY_COMMANDS } from './presets.js';
import { isPowerShellShell } from './powershell.js';

/**
 * Evaluate every segment against the merged policy.
 *
 * Precedence per segment: hard-deny (global) > workspace deny > forced ask
 * for dynamic values > workspace ask > workspace allow > built-in read-only >
 * policy default mode. The overall verdict is the worst across segments.
 *
 * On PowerShell/cmd (`opts.shell`), command names compare case-insensitively
 * (cmdlets are case-insensitive; the PowerShell parser already lowercases,
 * this additionally lowercases policy pattern cmds so `Get-ChildItem` rules
 * still match). Args stay case-sensitive (paths may be case-sensitive).
 */
export function evaluatePolicy(
  segments: ShellSegment[],
  policy: TerminalPolicy,
  hardDeny: string[],
  opts?: { shell?: string },
): PolicyDecision {
  const segDecisions = segments.map((segment) => evaluateSegment(segment, policy, hardDeny, opts));
  const verdict = worstVerdict(segDecisions.map((d) => d.verdict));
  return { verdict, segments: segDecisions, requiresApproval: verdict === 'ask' };
}

function evaluateSegment(
  segment: ShellSegment,
  policy: TerminalPolicy,
  hardDeny: string[],
  opts?: { shell?: string },
): SegmentDecision {
  const ps = isPowerShellShell(opts?.shell);
  const seg = ps ? { ...segment, cmd: segment.cmd.toLowerCase() } : segment;
  const matches = (pattern: string): boolean => {
    const parsed = parsePattern(pattern);
    const pat = ps ? { ...parsed, cmd: parsed.cmd.toLowerCase() } : parsed;
    return matchRule(pat, seg);
  };
  for (const pattern of hardDeny) {
    if (matches(pattern)) {
      return { verdict: 'deny', match: { tier: 'hard', pattern }, segment };
    }
  }
  for (const pattern of policy.deny) {
    if (matches(pattern)) {
      return { verdict: 'deny', match: { tier: 'workspace', pattern }, segment };
    }
  }
  if (segment.hasCommandSubst) {
    return {
      verdict: 'ask',
      reason: 'command substitution makes the value dynamic',
      match: { tier: 'hard' },
      segment,
    };
  }
  for (const pattern of policy.ask) {
    if (matches(pattern)) {
      return { verdict: 'ask', match: { tier: 'workspace', pattern }, segment };
    }
  }
  for (const pattern of policy.allow) {
    if (matches(pattern)) {
      return { verdict: 'allow', match: { tier: 'workspace', pattern }, segment };
    }
  }
  if (READONLY_COMMANDS.has(ps ? seg.cmd : segment.cmd)) {
    return { verdict: 'allow', match: { tier: 'readonly' }, segment };
  }
  return { verdict: policy.mode, match: { tier: 'default' }, segment };
}

function worstVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('deny')) return 'deny';
  if (verdicts.includes('ask')) return 'ask';
  return 'allow';
}
