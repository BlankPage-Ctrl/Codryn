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
import type { ISubAgentLive } from '../../../src/runs/index.js';
import { toSubRunKey } from '../../../src/runs/index.js';
import { DEFAULT_TIMEOUT_MS, type IHitlService } from '../../../src/human-in-the-loop/index.js';
import type { OnRichResult } from '../tools/rich-result.js';
import { formatSubAgentError } from '../tools/format.js';
import { isAbortError, mapAiError } from '../../shared/ai-errors/index.js';
import type { Logger } from '../../shared/types.js';
import { createFeedBridge, type FeedBridge } from '../../shared/chat-feed/bridge.js';
import { createSubFeedRecorder, type SubFeedRecorder } from '../../shared/run-steps.js';
import { filterChildTools } from './filter.js';
import { cancelSubAgentHitl, withSubAgentHitlScope } from './hitl-scope.js';
import {
  DELEGATE_TOOL_NAME,
  DESCRIBE_SUBAGENT_TOOL_NAME,
  MAX_SUBAGENT_OUTPUT_CHARS,
  type SubAgentDef,
} from './types.js';

export const delegateTaskSchema = z.object({
  agent_name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe('Sub-agent name; see the sub-agents list in the system prompt'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe('Short human-readable title for this sub-agent run.'),
  task: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe('Self-contained task: goal, context, and expected result'),
});

export const describeSubagentSchema = z.object({
  agent_name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe('Sub-agent name to describe. Omit to list every sub-agent.'),
});

export interface ChildRunScope {
  parentRunId: string;
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
}

export interface ChildToolScope extends ChildRunScope {
  subKey: string;
  toolCallId: string;
  agentName: string;
  title: string;
}

export interface ChildToolsetArgs {
  baseTools: AgentTool[];
  def: SubAgentDef;
  scope: ChildToolScope;
  onRichResult: OnRichResult;
}

export interface DelegateToolDeps {
  agents: SubAgentDef[];
  parentModel: ResolvedModel;
  agent: Pick<AgentClient, 'loop'>;
  baseTools: AgentTool[];
  resolveModelHint: (hint: string) => Promise<ResolvedModel | null>;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number | null;
  onRichResult?: OnRichResult;
  logger?: Logger;
  signal?: AbortSignal;
  subLive?: ISubAgentLive;
  hitl?: Pick<IHitlService, 'listPending' | 'cancel'>;
  parentRun?: ChildRunScope;
  buildChildBaseTools?: (onRichResult: OnRichResult) => AgentTool[];
  childToolset?: (args: ChildToolsetArgs) => AgentTool[];
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

// A child that asks the human must outlive the default HITL window, otherwise
// its question expires while the child is already aborted.
const HITL_TIMEOUT_MARGIN_MS = 15_000;

function resolveChildTimeoutMs(def: SubAgentDef, canAskHuman: boolean): number {
  if (!canAskHuman) return def.timeoutMs;
  return Math.max(def.timeoutMs, DEFAULT_TIMEOUT_MS + HITL_TIMEOUT_MARGIN_MS);
}

/** `delegate_task` plus `describe_subagent`. Returns [] when no sub-agents are registered. */
export function createSubAgentTool(deps: DelegateToolDeps): AgentTool[] {
  if (deps.agents.length === 0) return [];
  const byName = new Map(deps.agents.map((a) => [a.name, a]));

  const tool: AgentTool<typeof delegateTaskSchema> = {
    name: DELEGATE_TOOL_NAME,
    description: [
      'Delegate a self-contained task to a specialized sub-agent.',
      'The child runs in its own context with a subset of your tools and returns only its final answer.',
      'The task must carry all context: goal, relevant files, constraints, and expected result.',
    ].join(' '),
    inputSchema: delegateTaskSchema,
    execute: async (
      { agent_name, title, task }: z.infer<typeof delegateTaskSchema>,
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
      const toolCallId = toolOptions?.toolCallId ?? null;
      const parentSignal = toolOptions?.abortSignal ?? deps.signal;

      // parent run id (`sub:<parentRunId>:<toolCallId>`).
      const scope: ChildToolScope | null =
        deps.parentRun && toolCallId
          ? {
              subKey: toSubRunKey(deps.parentRun.parentRunId, toolCallId),
              parentRunId: deps.parentRun.parentRunId,
              chatId: deps.parentRun.chatId,
              workspaceId: deps.parentRun.workspaceId,
              assistantMessageId: deps.parentRun.assistantMessageId,
              toolCallId,
              agentName: def.name,
              title,
            }
          : null;

      let bridge: FeedBridge | null = null;
      if (scope && deps.subLive) {
        deps.subLive.ensureSub({
          parentRunId: scope.parentRunId,
          chatId: scope.chatId,
          workspaceId: scope.workspaceId,
          assistantMessageId: scope.assistantMessageId,
          toolCallId: scope.toolCallId,
          agentName: scope.agentName,
          title: scope.title,
        });
        if (deps.logger) {
          bridge = createFeedBridge({
            publishChunk: (line) => {
              deps.subLive?.publishSubChunk(scope.subKey, line);
            },
            logger: deps.logger,
            runId: scope.subKey,
            chatId: scope.chatId,
            assistantMessageId: scope.subKey,
            title: scope.title,
          });
        }
      }

      const childRich: OnRichResult = (rich) => {
        if (!bridge) return;
        try {
          bridge.emitSafe('notice', {
            ...bridge.scope,
            sliceId: `${rich.toolCallId}:rich:${rich.implement}`,
            callId: rich.toolCallId,
            implement: rich.implement,
            body: rich.body,
            at: Date.now(),
          });
        } catch {
          // Rich forward is best-effort, the text result is the contract.
        }
      };

      const recorder: SubFeedRecorder | null =
        bridge && deps.logger
          ? createSubFeedRecorder({
              bridge,
              logger: deps.logger,
              ...(scope
                ? {
                    scopeToolCallId: (_toolName: string, id: string) =>
                      `${scope.parentRunId}:${id}`,
                  }
                : {}),
            })
          : null;

      // Tools built for the parent close over the parent's rich-result sink.
      // Rebuild the base toolset with the child sink so a child tool never
      // publishes work/rich events into the parent feed.
      const childBaseTools =
        deps.buildChildBaseTools && scope
          ? deps.buildChildBaseTools(childRich)
          : deps.baseTools;

      const childTools =
        deps.childToolset && scope
          ? deps.childToolset({
              baseTools: childBaseTools,
              def,
              scope,
              onRichResult: childRich,
            })
          : filterChildTools(childBaseTools, def);

      const scopedTools = scope
        ? childTools.map((tool) => withSubAgentHitlScope(tool, scope))
        : childTools;

      const canAskHuman = scopedTools.some((tool) => tool.name === 'request_human');
      const timeoutMs = resolveChildTimeoutMs(def, canAskHuman);
      const system = canAskHuman
        ? [
            def.systemPrompt,
            '',
            'You can ask the user a question with the request_human tool. The answer comes back to you, so use it only when the task cannot move forward without it.',
          ].join('\n')
        : def.systemPrompt;

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
        const result = await deps.agent.loop({
          model,
          system,
          messages: [{ role: 'user', content: task }],
          tools: buildToolset(scopedTools),
          stopWhen: stepCountIs(def.maxSteps),
          ...(recorder ? { onChunk: recorder.onChunk, onStepFinish: recorder.onStepFinish } : {}),
          ...(deps.thinkingLevel ? { thinkingLevel: deps.thinkingLevel } : {}),
          ...(deps.maxOutputTokens != null ? { maxOutputTokens: deps.maxOutputTokens } : {}),
          maxRetries: 2,
          abortSignal: childSignal(parentSignal, timeoutMs),
        });
        const capped = truncate(await result.text);
        text = capped.text;
        truncated = capped.truncated;
      } catch (err) {
        // A dead child must not leave a question waiting for the human.
        if (scope && deps.hitl) {
          const cleanup = await cancelSubAgentHitl(
            deps.hitl,
            (owner) => owner.toolCallId === scope.toolCallId,
          );
          if (cleanup.cancelled) {
            deps.logger?.info(
              { agentName: def.name, cancelled: cleanup.cancelled },
              'subagent pending hitl cancelled',
            );
          }
          if (cleanup.failures) {
            deps.logger?.warn(
              { agentName: def.name, failures: cleanup.failures },
              'subagent pending hitl cleanup failed',
            );
          }
        }
        // Parent cancellation and child timeout both surface as aborts:
        // the parent signal decides which one the model sees.
        const parentCancelled = parentSignal?.aborted === true;
        if (isChildAbort(err) || parentCancelled) {
          deps.logger?.warn(
            { agentName: def.name, timeoutMs, parentCancelled },
            parentCancelled ? 'subagent aborted by run cancel' : 'subagent timed out',
          );
          const code = parentCancelled ? 'CHILD_ABORTED' : 'CHILD_TIMEOUT';
          const message = parentCancelled
            ? `Sub-agent "${def.name}" stopped because the run was cancelled.`
            : `Sub-agent "${def.name}" timed out after ${timeoutMs}ms.`;
          if (scope) {
            deps.subLive?.publishSubError(scope.subKey, {
              status: parentCancelled ? 'cancelled' : 'failed',
              code,
              message,
            });
          }
          return formatSubAgentError(code, message);
        }
        const mapped = mapAiError(err);
        const message = `Sub-agent "${def.name}" failed. ${mapped.message}`;
        if (scope) {
          deps.subLive?.publishSubError(scope.subKey, {
            status: 'failed',
            code: mapped.code,
            message: mapped.message,
          });
        }
        return formatSubAgentError('CHILD_FAILED', message);
      }

      if (scope) deps.subLive?.publishSubDone(scope.subKey);

      if (toolCallId && deps.onRichResult) {
        try {
          deps.onRichResult({
            toolCallId,
            implement: DELEGATE_TOOL_NAME,
            body: {
              agentName: def.name,
              title,
              fallback,
              truncated,
              toolCount: childTools.length,
              ...(scope ? { subKey: scope.subKey } : {}),
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

  const describeTool: AgentTool<typeof describeSubagentSchema> = {
    name: DESCRIBE_SUBAGENT_TOOL_NAME,
    description: ['Describe what a sub-agent does.'].join(' '),
    inputSchema: describeSubagentSchema,
    execute: async ({ agent_name }: z.infer<typeof describeSubagentSchema>) => {
      if (!agent_name) {
        return deps.agents.map((a) => `${a.name}: ${a.description}`).join('\n');
      }
      const def = byName.get(agent_name);
      if (!def) {
        return formatSubAgentError(
          'UNKNOWN_AGENT',
          `Sub-agent "${agent_name}" not found.`,
          deps.agents.map((a) => a.name),
        );
      }
      return `${def.name}: ${def.description}`;
    },
  };

  return [tool, describeTool];
}
