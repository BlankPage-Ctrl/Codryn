import { stepCountIs } from 'ai';
import { z } from 'zod';
import {
  buildToolset,
  type AgentClient,
  type AgentTool,
  type AgentToolExecuteOptions,
  type ResolvedModel,
  type ThinkingLevel,
} from '../../../src/agent/index.js';
import type { OnRichResult } from '../tools/rich-result.js';
import { formatSubAgentError } from '../tools/format.js';
import { isAbortError, mapAiError } from '../../shared/ai-errors/index.js';
import type { Logger } from '../../shared/types.js';
import { describeSubAgents } from './registry.js';
import { filterChildTools } from './filter.js';
import { DELEGATE_TOOL_NAME, MAX_SUBAGENT_OUTPUT_CHARS, type SubAgentDef } from './types.js';

export const delegateTaskSchema = z.object({
  agent_name: z.string().trim().min(1).max(64).describe('Sub-agent name from the available list'),
  task: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe('Self-contained task: goal, context, and expected result'),
});

export interface DelegateToolDeps {
  agents: SubAgentDef[];
  parentModel: ResolvedModel;
  agent: Pick<AgentClient, 'generate'>;
  baseTools: AgentTool[];
  resolveModelHint: (hint: string) => Promise<ResolvedModel | null>;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number | null;
  onRichResult?: OnRichResult;
  logger?: Logger;
  signal?: AbortSignal;
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_SUBAGENT_OUTPUT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_SUBAGENT_OUTPUT_CHARS)}\n[truncated: child output exceeded ${MAX_SUBAGENT_OUTPUT_CHARS} chars]`,
    truncated: true,
  };
}

function isChildAbort(err: unknown): boolean {
  if (isAbortError(err)) return true;
  return (err as { name?: unknown })?.name === 'TimeoutError';
}

function childSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!parent) return AbortSignal.timeout(timeoutMs);
  if (parent.aborted) return parent;
  return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
}

/** Single `delegate_task` tool. Returns [] when no sub-agents are registered. */
export function createSubAgentTool(deps: DelegateToolDeps): AgentTool[] {
  if (deps.agents.length === 0) return [];
  const byName = new Map(deps.agents.map((a) => [a.name, a]));

  const tool: AgentTool<typeof delegateTaskSchema> = {
    name: DELEGATE_TOOL_NAME,
    description: [
      'Delegate a self-contained task to a specialized sub-agent.',
      'The child runs in its own context with a subset of your tools and returns only its final answer.',
      'The task must carry all context: goal, relevant files, constraints, and expected result.',
      `Available sub-agents: ${describeSubAgents(deps.agents)}.`,
    ].join(' '),
    inputSchema: delegateTaskSchema,
    execute: async (
      { agent_name, task }: z.infer<typeof delegateTaskSchema>,
      toolOptions?: AgentToolExecuteOptions,
    ) => {
      const def = byName.get(agent_name);
      if (!def) {
        return formatSubAgentError(
          'UNKNOWN_AGENT',
          `Sub-agent "${agent_name}" not found.`,
          deps.agents.map((a) => a.name),
        );
      }
      const toolCallId = toolOptions?.toolCallId;
      const parentSignal = toolOptions?.signal ?? deps.signal;
      const childTools = filterChildTools(deps.baseTools, def);

      let model = deps.parentModel;
      let fallback: string | null = null;
      if (def.modelHint) {
        try {
          const hinted = await deps.resolveModelHint(def.modelHint);
          if (hinted) model = hinted;
          else fallback = def.modelHint;
        } catch (err) {
          deps.logger?.warn({ err, hint: def.modelHint }, 'subagent model hint failed');
          fallback = def.modelHint;
        }
      }

      let text: string;
      let truncated: boolean;
      try {
        const result = await deps.agent.generate({
          model,
          system: def.systemPrompt,
          prompt: task,
          tools: buildToolset(childTools),
          stopWhen: stepCountIs(def.maxSteps),
          ...(deps.thinkingLevel ? { thinkingLevel: deps.thinkingLevel } : {}),
          ...(deps.maxOutputTokens != null ? { maxOutputTokens: deps.maxOutputTokens } : {}),
          maxRetries: 2,
          abortSignal: childSignal(parentSignal, def.timeoutMs),
        });
        const capped = truncate(result.text);
        text = capped.text;
        truncated = capped.truncated;
      } catch (err) {
        // Parent cancellation and child timeout both surface as aborts:
        // the parent signal decides which one the model sees.
        const parentCancelled = parentSignal?.aborted === true;
        if (isChildAbort(err) || parentCancelled) {
          deps.logger?.warn(
            { agentName: def.name, timeoutMs: def.timeoutMs, parentCancelled },
            parentCancelled ? 'subagent aborted by run cancel' : 'subagent timed out',
          );
          return formatSubAgentError(
            parentCancelled ? 'CHILD_ABORTED' : 'CHILD_TIMEOUT',
            parentCancelled
              ? `Sub-agent "${def.name}" stopped because the run was cancelled.`
              : `Sub-agent "${def.name}" timed out after ${def.timeoutMs}ms.`,
          );
        }
        const mapped = mapAiError(err);
        return formatSubAgentError(
          'CHILD_FAILED',
          `Sub-agent "${def.name}" failed. ${mapped.message}`,
        );
      }

      if (toolCallId && deps.onRichResult) {
        try {
          deps.onRichResult({
            toolCallId,
            implement: DELEGATE_TOOL_NAME,
            body: {
              agentName: def.name,
              fallback,
              truncated,
              toolCount: childTools.length,
            },
          });
        } catch {
          // Rich forward is best-effort, the text result is the contract.
        }
      }
      if (fallback) {
        return [`[model hint "${fallback}" unavailable, ran on the parent model]`, '', text].join(
          '\n',
        );
      }
      return text;
    },
  };
  return [tool];
}
