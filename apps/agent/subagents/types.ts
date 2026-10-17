import path from 'node:path';
import type { AgentMode } from '../modes.js';

export type SubAgentMode = AgentMode;

export interface SubAgentDef {
  name: string;
  description: string;
  mode: SubAgentMode;
  tools?: string[];
  disallowedTools?: string[];
  maxSteps: number;
  timeoutMs: number;
  modelHint?: string;
  systemPrompt: string;
  location: string;
}

export interface SubAgentWarning {
  location: string;
  message: string;
}

export const DELEGATE_TOOL_NAME = 'delegate_task';
export const DESCRIBE_SUBAGENT_TOOL_NAME = 'describe_subagent';

export const DEFAULT_SUBAGENT_MAX_STEPS = 20;
export const MAX_SUBAGENT_MAX_STEPS = 50;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 120_000;
export const MAX_SUBAGENT_OUTPUT_CHARS = 12_000;

export function subAgentDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), '.codryn', 'agents');
}
