import type { ModelCapability, ThinkingLevel } from '../../../../src/agent/types/index.js';

export const LEVEL_ORDER: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

export function toPortable(
  level: ThinkingLevel,
  fallback: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  if (level === 'none' || level === 'default') return fallback;
  return level;
}

export function clampLevel(level: ThinkingLevel, range: string[] | null): ThinkingLevel {
  if (!range || range.length === 0) return level;
  const resolved = level === 'default' ? 'medium' : level;
  if (range.includes(resolved)) return resolved as ThinkingLevel;

  const target = LEVEL_ORDER[resolved] ?? 2;
  let best = range[0];
  let bestDist = Infinity;
  for (const candidate of range) {
    const dist = Math.abs((LEVEL_ORDER[candidate] ?? 2) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return (best as ThinkingLevel) || 'medium';
}

export function resolveReasoningLevel(
  level: ThinkingLevel,
  capability?: ModelCapability | null,
): { omit: boolean; level: ThinkingLevel } {
  if (!capability) return { omit: false, level };
  if (!capability.reasoning) return { omit: true, level };

  const effectiveLevel = !capability.thinkingCanDisable && level === 'none' ? 'medium' : level;
  return { omit: false, level: clampLevel(effectiveLevel, capability.thinkingRange) };
}

export interface ReasoningBuildArgs {
  level: ThinkingLevel;
  capability?: ModelCapability | null;
  providerName?: string;
}
