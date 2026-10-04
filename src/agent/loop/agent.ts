import { stepCountIs, type ToolSet } from 'ai';
import { streamModel } from '../engines/stream.js';
import type { AgentLoopConfig } from '../types/index.js';

const DEFAULT_MAX_STEPS = 50;
const HARD_MAX_STEPS = 100;

export function resolveMaxSteps(requested?: number): number {
  if (requested == null || !Number.isFinite(requested)) return DEFAULT_MAX_STEPS;
  return Math.min(HARD_MAX_STEPS, Math.max(1, Math.round(requested)));
}

export function runAgentLoop<T extends ToolSet = ToolSet>(config: AgentLoopConfig<T>) {
  const { maxSteps, ...rest } = config as AgentLoopConfig<T> & { maxSteps?: number };
  const effectiveStopWhen = config.stopWhen ?? stepCountIs(resolveMaxSteps(maxSteps));
  return streamModel({
    ...rest,
    stopWhen: effectiveStopWhen,
  });
}
