import { convertToModelMessages, createIdGenerator, type UIMessage } from 'ai';
import type { Container } from '../bootstrap.js';
import {
  isThinkingLevel,
  buildToolset,
  toUIMessageStreamResponse,
  type ThinkingLevel,
} from '../../src/agent/index.js';
import { repairUnresolvedToolCalls } from '../../src/messages/index.js';
import {
  collectAttachmentIds,
  linkIncomingAttachments,
  resolveAttachmentsForModel,
} from '../shared/attachment-refs.js';
import { buildMessageRunToolset } from '../agent/message-toolset.js';
import {
  createSubAgentTool,
  filterChildTools,
  loadSubAgentsForWorkspace,
  matchModelHint,
} from '../agent/subagents/index.js';
import { createHitlTool, createShellTool } from '../agent/tools/index.js';
import { resolveShellPermissionViaHitl } from '../shared/shell-permission.js';
import { toProviderConfig } from '../providers/translate.js';
import { createFeedBridge } from '../shared/chat-feed/bridge.js';
import { createStepRecorder } from '../shared/run-steps.js';
import {
  createRunEndHandler,
  createRunStreamErrorHandler,
  drainStreamBody,
  handleBackgroundRunFailure,
} from '../shared/run-driver.js';
import type { OnRichResult } from '../agent/index.js';
import { getMcpAgentTools } from '../agent/tools/mcp.js';
import { isInsightEnabled } from '../insight/execute/settings.js';
import { buildIdentitySystemPrompt, resolveAgentMode } from '../agent/modes.js';
import {
  formatAgentsMdSection,
  loadAgentsMdForWorkspace,
  toAgentsMdPort,
} from '../agent/agents-md/index.js';
import {
  loadSkillsForWorkspace,
  projectSkillDir,
  resolveGlobalRoot,
  toProjectSkillPort,
  type SkillSources,
} from '../skills/index.js';
import { buildPluginBootstrap, loadPluginStates } from '../plugins/index.js';
import { buildFmServices } from '../shared/fm-services.js';
import { buildShellConsumer } from '../shared/shell-consumer.js';
import {
  assembleMessageContext,
  assertInputTokenLimit,
  attachMentionPart,
  attachPlanNoticeSafe,
  loadChatHistory,
} from '../shared/message-context.js';
import { AppError, NotFoundError, ValidationError } from '../shared/errors.js';
import { isAbortError, mapAiError } from '../shared/ai-errors/index.js';
import { resolveChatModel } from '../shared/model-resolver.js';
import { getDefaultProviderGlobal } from '../shared/global-settings.js';
import { MessagesDomainError } from '../../src/messages/errors/base.js';
import type { RunRecord } from '../../src/runs/index.js';

const messageIdGen = createIdGenerator({ prefix: 'msg', size: 16 });

/** Wall-clock budget for one run; longer runs are reported as timeouts. */
const RUN_BUDGET_MS = 2 * 60 * 60 * 1_000;

export interface StartMessageRunParams {
  workspaceId: string;
  chatId: string;
  message: UIMessage;
}

export interface StartMessageRunResult {
  run: RunRecord;
  assistantMessageId: string;
}

export async function startMessageRun(
  ctx: Container,
  params: StartMessageRunParams,
): Promise<StartMessageRunResult> {
  const chat = await ctx.chatService.findOne(params.chatId, params.workspaceId);
  if (!chat) throw new NotFoundError(`Chat ${params.chatId} not found`);

  const workspace = await ctx.workspacesService.findOne(params.workspaceId);
  const pluginLoad = ctx.pluginsEnabled
    ? await loadPluginStates(
        workspace.projectPath,
        params.workspaceId,
        ctx.settingsService,
        ctx.logger,
        ctx.pluginLimits,
        ctx.hitlService,
      )
    : { states: [], skills: [], tools: [], host: null as never };
  const pluginBootstrap = buildPluginBootstrap(pluginLoad.states);
  const skillSources: SkillSources = {
    globalRoot: resolveGlobalRoot(),
    project: toProjectSkillPort(ctx.fileRepo, projectSkillDir(workspace.projectPath)),
    ...(pluginLoad.skills.length > 0 ? { pluginSkills: pluginLoad.skills } : {}),
  };
  const skills = await loadSkillsForWorkspace(skillSources, ctx.logger);
  const agentsMd = formatAgentsMdSection(
    await loadAgentsMdForWorkspace(
      toAgentsMdPort(ctx.fileRepo, workspace.projectPath),
      ctx.logger,
    ).catch(() => null),
  );

  const defaults = await getDefaultProviderGlobal(ctx);
  const resolved = await resolveChatModel(ctx, chat, defaults);
  if (!resolved.ok) throw new ValidationError(resolved.error.message);
  const mode = resolveAgentMode(chat.mode);

  // Per-model token limits (null = unlimited).
  const limitModelId = chat.model_id ?? defaults?.modelId ?? null;
  const limitModel = limitModelId ? await ctx.providerStore.findModelById(limitModelId) : null;
  const maxInputTokens = limitModel?.maxInputTokens ?? null;
  const maxOutputTokens = limitModel?.maxOutputTokens ?? null;

  const thinkingLevel: ThinkingLevel = isThinkingLevel(chat.thinking_mode)
    ? chat.thinking_mode
    : 'default';

  const fm = await buildFmServices(ctx, workspace.projectPath);
  const shellConsumer = buildShellConsumer(ctx, workspace.projectPath, params.workspaceId);

  const history = await loadChatHistory(ctx, params.chatId);
  const { context, userText } = assembleMessageContext(history, params.message, mode);
  if (mode === 'edit') {
    await attachPlanNoticeSafe(
      ctx,
      context,
      params.message.id,
      workspace.projectPath,
      params.chatId,
    );
  }
  await attachMentionPart(
    ctx,
    context,
    params.message.id,
    workspace.projectPath,
    userText,
    params.workspaceId,
  );

  const persistMessage: UIMessage = context.getMessage(params.message.id)!;
  const assistantMessageId = messageIdGen();

  const persister = ctx.messagesService.createStreamingPersister(
    { chatId: params.chatId, userMessage: persistMessage, assistantMessageId },
    (err) => ctx.logger.error({ sensitive: true, err }, 'message persistence error'),
  );

  try {
    await persister.prepare();
  } catch (err) {
    ctx.logger.error({ sensitive: true, err }, 'failed to persist user message');
    if (err instanceof MessagesDomainError) {
      throw new AppError(
        err.statusCode,
        err.message,
        err.code === 'VALIDATION_FAILED' ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
      );
    }
    throw new AppError(500, 'Failed to persist message');
  }

  // Referenced attachments move from pending to linked once persisted.
  const incomingAttachmentIds = collectAttachmentIds([persistMessage]);
  await linkIncomingAttachments(ctx.attachmentsService, params.workspaceId, incomingAttachmentIds);

  const run = await ctx.runService.create({
    chatId: params.chatId,
    workspaceId: params.workspaceId,
    assistantMessageId,
  });
  const runId = run.runId;
  const getAbortSignal = (): AbortSignal | undefined =>
    ctx.runService.abortSignal(runId) ?? undefined;

  // History can reference older attachments too, so translate the full
  // context. The assembler keeps the opaque refs; only this copy carries data-URLs.
  const assembledMessages = context.resolve();
  const modelUiMessages = await resolveAttachmentsForModel(
    ctx.attachmentsService,
    assembledMessages,
    params.workspaceId,
  );
  const messages = await convertToModelMessages(repairUnresolvedToolCalls(modelUiMessages));
  assertInputTokenLimit(
    messages as Array<{ content?: unknown }>,
    maxInputTokens,
    limitModel?.modelId ?? 'unknown',
  );

  // Detached background task - never awaited by the caller.
  void (async () => {
    // set once persister.finalize() succeeded, the catch-all below must not
    // discard() a successfully finalized message (e.g. when a late tail
    // publish races the terminal event).
    let finalized = false;
    const markFinalized = (): void => {
      finalized = true;
    };
    const cancelSignal = getAbortSignal();
    const budgetSignal = AbortSignal.timeout(RUN_BUDGET_MS);
    const loopSignal = cancelSignal ? AbortSignal.any([cancelSignal, budgetSignal]) : budgetSignal;
    const isTimedOut = (): boolean => budgetSignal.aborted && cancelSignal?.aborted !== true;
    const bridge = createFeedBridge({
      publishChunk: (line) => ctx.runService.publishChunk(runId, line),
      logger: ctx.logger,
      runId,
      chatId: params.chatId,
      assistantMessageId,
    });

    let insightEnabled: boolean | null = null;
    try {
      insightEnabled = await isInsightEnabled(
        ctx.settingsService as unknown as import('../insight/types.js').InsightSettingsPort,
        params.workspaceId,
      );
    } catch (err) {
      ctx.logger.warn({ err, workspaceId: params.workspaceId }, 'insight enabled check failed');
    }
    const insightDeps = {
      workspaceId: params.workspaceId,
      projectPath: workspace.projectPath,
      settings: ctx.settingsService as unknown as import('../insight/types.js').InsightSettingsPort,
    };

    const recorder = createStepRecorder({
      store: ctx.messagesService,
      persister,
      bridge,
      logger: ctx.logger,
      runId,
      chatId: params.chatId,
      assistantMessageId,
    });

    try {
      // MCP tools (fail-open: zero tools when disabled/unreachable).
      const mcpTools = await getMcpAgentTools(
        ctx,
        { id: params.workspaceId, projectPath: workspace.projectPath },
        params.chatId,
      );
      const response = toUIMessageStreamResponse(
        async () => {
          const handleRich: OnRichResult = (rich) => {
            bridge.emitSafe('notice', {
              ...bridge.scope,
              sliceId: `${rich.toolCallId}:rich:${rich.implement}`,
              callId: rich.toolCallId,
              implement: rich.implement,
              body: rich.body,
              at: Date.now(),
            });
            try {
              persister.attachData(rich.toolCallId, rich.body);
            } catch (err) {
              ctx.logger.error({ err, runId }, 'rich attach failed');
            }
          };
          // Parent tools first, then the delegate tool on top. The child
          // reuses a filtered copy of the parent tools and can never
          // delegate further, so depth stays at one level.
          const { agents: subagents } = await loadSubAgentsForWorkspace({
            fileRepo: ctx.fileRepo,
            projectPath: workspace.projectPath,
            logger: ctx.logger,
          });
          const buildRunTools = async () => {
            const liveSignal = getAbortSignal();
            // Each feed owner (parent, and each child) needs its own tool
            // instances so rich results are published to the right feed.
            const buildBaseTools = (onRichResult: OnRichResult) =>
              buildMessageRunToolset({
                fm,
                shellConsumer,
                shellEnabled: ctx.shellEnabled,
                skillSources,
                hitlService: ctx.hitlService,
                insightDeps,
                workspaceId: params.workspaceId,
                chatId: params.chatId,
                projectPath: workspace.projectPath,
                workspaceRoot: workspace.projectPath,
                assistantMessageId,
                runId,
                ...(liveSignal ? { signal: liveSignal } : {}),
                mode,
                mcpTools,
                pluginTools: pluginLoad.tools,
                onRichResult,
                logger: ctx.logger,
              });
            const baseTools = buildBaseTools(handleRich);
            const delegateTools = createSubAgentTool({
              agents: subagents,
              parentModel: resolved.data,
              agent: ctx.agent,
              baseTools,
              buildChildBaseTools: buildBaseTools,
              resolveModelHint: async (hint) => {
                try {
                  const providers = await ctx.providerStore.findAllWithModels();
                  const match = matchModelHint(providers, hint);
                  if (!match) return null;
                  const provider = providers.find((p) => p.id === match.providerId);
                  if (!provider) return null;
                  return { providerConfig: toProviderConfig(provider), modelId: match.modelId };
                } catch (err) {
                  ctx.logger.warn({ err, hint }, 'subagent model hint lookup failed');
                  return null;
                }
              },
              thinkingLevel,
              ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
              onRichResult: handleRich,
              logger: ctx.logger,
              ...(liveSignal ? { signal: liveSignal } : {}),
              subLive: ctx.runService,
              hitl: ctx.hitlService,
              parentRun: {
                parentRunId: runId,
                chatId: params.chatId,
                workspaceId: params.workspaceId,
                assistantMessageId,
              },
              childToolset: ({ baseTools: tools, def, scope, onRichResult }) => {
                const filtered = filterChildTools(tools, def);
                return filtered.map((tool) => {
                  if (tool.name === 'run_shell') {
                    const [scoped] = createShellTool(shellConsumer, {
                      chatId: params.chatId,
                      runId: scope.subKey,
                      callScope: scope.parentRunId,
                      resolvePermission: (pending) =>
                        resolveShellPermissionViaHitl(ctx.hitlService, pending, {
                          workspaceRoot: workspace.projectPath,
                          logger: ctx.logger,
                          ...(liveSignal ? { signal: liveSignal } : {}),
                        }),
                      onRichResult,
                    });
                    return scoped ?? tool;
                  }
                  if (tool.name === 'request_human') {
                    // Rebuilt so the answer lands in the child feed instead of
                    // the parent assistant message.
                    const [scoped] = createHitlTool(
                      ctx.hitlService,
                      { chatId: params.chatId, workspaceId: params.workspaceId },
                      { onRichResult },
                    );
                    return scoped ?? tool;
                  }
                  return tool;
                });
              },
            });
            return [...baseTools, ...delegateTools];
          };
          return ctx.agent.loop({
            model: resolved.data,
            ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
            system: buildIdentitySystemPrompt({
              base: chat.system_prompt ?? undefined,
              skills,
              projectPath: workspace.projectPath,
              ...(agentsMd ? { agentsMd } : {}),
              insightEnabled,
              ...(pluginBootstrap ? { pluginBootstrap } : {}),
              subAgentNames: subagents.map((a) => a.name),
            }),
            messages,
            tools: buildToolset(await buildRunTools()),
            thinkingLevel,
            maxRetries: 3,
            // Tools enforce their own limits; a chunk timeout would cancel the
            // run because the AI SDK counts that gap while a tool is running.
            timeout: {
              stepMs: 1_800_000,
            },
            abortSignal: loopSignal,
            onError: ({ error }) => {
              const isTimeout = (error as { name?: string })?.name === 'TimeoutError';
              const mapped = mapAiError(error, { chatId: params.chatId });
              const { stepCount, lastFinishReason } = recorder.getStats();
              // `error` may wrap prompt/tool content - local-only, never telemetry.
              ctx.logger.error(
                {
                  sensitive: true,
                  err: error,
                  isTimeout,
                  stepCount,
                  lastFinishReason,
                  mappedCode: mapped.code,
                },
                'agent stream error',
              );
            },
            onChunk: recorder.onChunk,
            onStepFinish: recorder.onStepFinish,
            onFinish: async (event: {
              finishReason: string;
              totalUsage?: unknown;
              steps?: unknown[];
            }) => {
              ctx.logger.info(
                {
                  runId,
                  stepCount: recorder.getStats().stepCount,
                  finishReason: event.finishReason,
                  totalUsage: event.totalUsage,
                },
                'agent finish',
              );
            },
            onAbort: async () => {
              const { stepCount, lastFinishReason } = recorder.getStats();
              ctx.logger.warn(
                { runId, stepCount, lastFinishReason, timedOut: isTimedOut() },
                'agent aborted',
              );
              void persister.interrupt();
            },
          });
        },
        {
          originalMessages: [...history, persistMessage],
          generateMessageId: () => assistantMessageId,
          sendSources: true,
          onEnd: createRunEndHandler({
            persister,
            runs: ctx.runService,
            logger: ctx.logger,
            runId,
            markFinalized,
            getStats: () => recorder.getStats(),
            isTimedOut,
          }),
          onError: createRunStreamErrorHandler({
            persister,
            bridge,
            logger: ctx.logger,
            chatId: params.chatId,
            runId,
            getStats: () => recorder.getStats(),
          }),
        },
      );

      if (!response.body) {
        await ctx.runService.finish(runId, 'failed', {
          code: 'INTERNAL_ERROR',
          message: 'Empty agent stream',
        });
        return;
      }
      await drainStreamBody(response.body);
    } catch (err) {
      const aborted = isAbortError(err) || getAbortSignal()?.aborted === true;
      await handleBackgroundRunFailure(
        {
          runs: ctx.runService,
          persister,
          bridge,
          logger: ctx.logger,
          chatId: params.chatId,
          runId,
          isTimedOut,
        },
        err,
        { aborted, finalized },
      );
    }
  })();

  return { run, assistantMessageId };
}
