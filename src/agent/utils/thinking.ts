import type { ThinkingLevel } from '../types/thinking.js';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'none',
  'default',
  'low',
  'medium',
  'high',
  'xhigh',
];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel);
}
