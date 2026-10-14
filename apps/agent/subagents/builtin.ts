import type { SubAgentDef } from './types.js';
import { DEFAULT_SUBAGENT_MAX_STEPS, DEFAULT_SUBAGENT_TIMEOUT_MS } from './types.js';

function builtin(def: Omit<SubAgentDef, 'location'>): SubAgentDef {
  return { ...def, location: 'builtin' };
}

export const BUILTIN_SUBAGENTS: SubAgentDef[] = [
  builtin({
    name: 'explorer',
    description:
      'Read-only codebase researcher. Finds relevant files, patterns, and entry points for a task.',
    mode: 'ask',
    maxSteps: DEFAULT_SUBAGENT_MAX_STEPS,
    timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    systemPrompt: [
      'You are explorer, a read-only codebase researcher.',
      'Given a task, find the relevant files, symbols, and existing patterns.',
      'Never edit files. If you find nothing, say so instead of inventing findings.',
      'Reply with: verdict first, then evidence as `path:line` references, then suggested next step.',
    ].join('\n'),
  }),
];
