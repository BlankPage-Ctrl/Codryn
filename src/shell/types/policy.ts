import { z } from 'zod';

export type Verdict = 'allow' | 'ask' | 'deny';

export const VerdictSchema = z.enum(['allow', 'ask', 'deny']);

/**
 * One command segment of a (possibly chained) shell command line.
 * `git add . && rm -rf /tmp/x` parses into two segments, each evaluated
 * independently by the policy.
 */
export interface ShellSegment {
  cmd: string;
  args: string[];
  reads: string[];
  writes: { path: string; mode: 'trunc' | 'append' }[];
  /** True when `$()`, backticks, or heredocs make the value dynamic. */
  hasCommandSubst: boolean;
}

export interface RulePattern {
  cmd: string;
  parts: (string | { prefix: string } | { suffix: string })[];
  trailingWildcard: boolean;
}

export interface TerminalPolicy {
  mode: Verdict;
  allow: string[];
  ask: string[];
  deny: string[];
}

export const TerminalPolicySchema = z.object({
  mode: VerdictSchema.default('ask'),
  allow: z.array(z.string()).default([]),
  ask: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

export interface GlobalShellConfig {
  enabled: boolean;
  shell: string;
  defaultTimeoutMs: number;
  maxOutputChars: number;
  defaultMode: Verdict;
  hardDeny: string[];
}

export interface PolicyMatch {
  tier: 'hard' | 'workspace' | 'readonly' | 'default';
  pattern?: string;
}

export interface SegmentDecision {
  segment: ShellSegment;
  verdict: Verdict;
  match?: PolicyMatch;
  reason?: string;
}

export interface PolicyDecision {
  /** Worst verdict across all segments (deny > ask > allow). */
  verdict: Verdict;
  segments: SegmentDecision[];
  requiresApproval: boolean;
}
