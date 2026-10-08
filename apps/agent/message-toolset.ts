import type { AgentTool } from '../../src/agent/index.js';
import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { ShellConsumer, ShellPendingApproval } from '../../src/shell/index.js';
import type { FmPermissionResolver } from '../shared/fm-permission.js';
import { resolveFmPermissionViaHitl } from '../shared/fm-permission.js';
import { resolveShellPermissionViaHitl } from '../shared/shell-permission.js';
import type { FmServices } from '../shared/fm-services.js';
import type { Logger } from '../shared/types.js';
import type { SkillSources } from '../skills/index.js';
import { commandDeniedByRules, toolDeniedByRules, type PluginHookRule } from '../plugins/index.js';
import type { InsightSettingsPort } from '../insight/types.js';
import type { AgentMode } from './modes.js';
import {
  createCreateFileTool,
  createEditTool,
  createGrepTool,
  createHitlTool,
  createInsightGraphTool,
  createInsightTraceTool,
  createListFilesTool,
  createReadFileTool,
  createReadPlanTool,
  createPlanTools,
  createShellTool,
  createSkillListTool,
  createSkillTool,
  type OnRichResult,
} from './tools/index.js';

export interface MessageInsightDeps {
  workspaceId: string;
  projectPath: string;
  settings: InsightSettingsPort;
}

export interface MessageToolsetDeps {
  fm: FmServices;
  shellConsumer: ShellConsumer;
  shellEnabled: boolean;
  skillSources: SkillSources;
  hitlService: IHitlService;
  insightDeps: MessageInsightDeps;
  workspaceId: string;
  chatId: string;
  projectPath: string;
  workspaceRoot: string;
  assistantMessageId: string;
  runId: string;
  mode: AgentMode;
  mcpTools: AgentTool[];
  onRichResult: OnRichResult;
  logger: Logger;
  pluginHookRules?: PluginHookRule[];
}

// Shared workspace+chat scoped FM permission resolver for list/read/grep tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFmResolver = FmPermissionResolver<any>;
function makeFmResolver(
  hitl: IHitlService,
  ctx: { workspaceId: string; chatId: string; logger?: Logger },
): AnyFmResolver {
  return (pending, toolCallId) =>
    resolveFmPermissionViaHitl(hitl, pending, {
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      toolCallId,
      ...(ctx.logger ? { logger: ctx.logger } : {}),
    });
}

/**
 * Assembles the full agent toolset for a message run.
 * Mode branches: `edit` gains file edits + plan read, `plan` gains plan
 * writes, `ask` stays read-only. MCP tools are appended last (fail-open).
 */
export function buildMessageRunToolset(deps: MessageToolsetDeps): AgentTool[] {
  const {
    fm,
    hitlService,
    workspaceId,
    chatId,
    projectPath,
    workspaceRoot,
    assistantMessageId,
    runId,
    mode,
    logger,
  } = deps;
  // The list/read resolvers share workspace+chat scoping; only grep forwards
  // the file logger (it logs outside-path attempts verbosely).
  const fmResolver = makeFmResolver(hitlService, { workspaceId, chatId });
  const fmResolverLogged = makeFmResolver(hitlService, { workspaceId, chatId, logger });
  const hookRules = deps.pluginHookRules ?? [];
  const shellResolver = (pending: ShellPendingApproval) => {
    const denied = commandDeniedByRules(hookRules, pending.permission.command ?? '');
    if (denied) {
      logger.warn(
        { sensitive: true, command: pending.permission.command, plugin: denied.pluginId },
        'plugins: shell command denied by hook rule, aborting before prompt',
      );
      return pending.abort();
    }
    return resolveShellPermissionViaHitl(hitlService, pending, {
      workspaceRoot,
      logger,
    });
  };
  const tools: AgentTool[] = [
    ...createListFilesTool(fm.listDirService, {
      onRichResult: deps.onRichResult,
      resolvePermission: fmResolver,
    }),
    ...createReadFileTool(fm.readFileService, {
      onRichResult: deps.onRichResult,
      projectPath,
      resolvePermission: fmResolver,
    }),
    ...createGrepTool(fm.grepService, { projectPath }, { resolvePermission: fmResolverLogged }),
    // ...createInsightSearchTool({ ...deps.insightDeps, readFile: fm.readFileService }),
    ...createInsightGraphTool(deps.insightDeps),
    ...createInsightTraceTool({ ...deps.insightDeps, readFile: fm.readFileService }),
    // Edit mode only: source edits. Ask/Plan stay read-only.
    // History context links every mutation to this run's assistant message
    // so revert-from-message can restore the affected files.
    ...(mode === 'edit'
      ? createEditTool(fm.editFileService, {
          onRichResult: deps.onRichResult,
          history: {
            workspaceId,
            chatId,
            messageId: assistantMessageId,
            runId,
          },
        })
      : []),
    ...(mode === 'edit'
      ? createCreateFileTool(fm.createFileService, {
          onRichResult: deps.onRichResult,
          history: {
            workspaceId,
            chatId,
            messageId: assistantMessageId,
            runId,
          },
        })
      : []),
    // Plan mode only: plan files under .codryn/plan/.
    ...(mode === 'plan'
      ? createPlanTools({
          projectPath,
          chatId,
          workspaceId,
          assistantMessageId,
        })
      : []),
    // Edit mode: read-only access to the active plan.
    ...(mode === 'edit' ? createReadPlanTool({ projectPath, chatId }) : []),
    ...createSkillTool({ sources: deps.skillSources, logger }),
    ...createSkillListTool({ sources: deps.skillSources, logger }),
    ...createHitlTool(hitlService, { chatId, workspaceId }, { onRichResult: deps.onRichResult }),
    ...(deps.shellEnabled
      ? createShellTool(deps.shellConsumer, {
          chatId,
          resolvePermission: shellResolver,
          onRichResult: deps.onRichResult,
        })
      : []),
    // MCP tools from the workspace's own `.mcp.json` (Tools wired to prod).
    ...deps.mcpTools,
  ];
  if (hookRules.length === 0) return tools;
  return tools.filter((tool) => {
    const denied = toolDeniedByRules(hookRules, tool.name);
    if (!denied) return true;
    logger.warn({ tool: tool.name, plugin: denied.pluginId }, 'plugins: tool removed by hook rule');
    return false;
  });
}
