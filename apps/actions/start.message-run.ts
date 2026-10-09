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
  loadSkillsForWorkspace,
  projectSkillDir,
  resolveGlobalRoot,
  toProjectSkillPort,
  type SkillSources,
} from '../skills/index.js';
import { buildPluginBootstrap, collectHookRules, loadPluginStates } from '../plugins/index.js';
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
      )
    : { states: [], skills: [] };
  const pluginBootstrap = buildPluginBootstrap(pluginLoad.states);
  const pluginHookRules = collectHookRules(pluginLoad.states);
  const skillSources: SkillSources = {
    globalRoot: resolveGlobalRoot(),
    project: toProjectSkillPort(ctx.fileRepo, projectSkillDir(workspace.projectPath)),
    ...(pluginLoad.skills.length > 0 ? { pluginSkills: pluginLoad.skills } : {}),
  };
  const skills = await loadSkillsForWorkspace(skillSources, ctx.logger);

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
  const abortSignal = ctx.runService.abortSignal(runId) ?? undefined;

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
        () => {
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
          return ctx.agent.loop({
            model: resolved.data,
            ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
            system: buildIdentitySystemPrompt({
              base: chat.system_prompt ?? undefined,
              skills,
              projectPath: workspace.projectPath,
              insightEnabled,
              ...(pluginBootstrap ? { pluginBootstrap } : {}),
            }),
            messages,
            tools: buildToolset(
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
                mode,
                mcpTools,
                onRichResult: handleRich,
                logger: ctx.logger,
                pluginHookRules,
              }),
            ),
            thinkingLevel,
            maxRetries: 3,
            timeout: { stepMs: 120_000, toolMs: 360_000 },
            ...(abortSignal ? { abortSignal } : {}),
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
              ctx.logger.warn({ runId, stepCount, lastFinishReason }, 'agent aborted');
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
      const aborted = isAbortError(err) || abortSignal?.aborted === true;
      await handleBackgroundRunFailure(
        {
          runs: ctx.runService,
          persister,
          bridge,
          logger: ctx.logger,
          chatId: params.chatId,
          runId,
        },
        err,
        { aborted, finalized },
      );
    }
  })();

  return { run, assistantMessageId };
}
