import { resolve } from 'node:path';
import type { ResolutionContext } from '../../src/mentions/index.js';

export function buildMentionContext(
  projectPath: string,
  opts?: { signal?: AbortSignal; tokenBudget?: number },
): ResolutionContext {
  return {
    workspaceRoot: projectPath,
    resolvePath: (requestedPath) => resolve(projectPath, requestedPath),
    signal: opts?.signal,
    tokenBudget: opts?.tokenBudget,
  };
}
