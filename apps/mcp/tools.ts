import type { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../src/agent/index.js';
import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { Container } from '../bootstrap.js';
import { resolveMcpPermissionViaHitl } from '../shared/mcp-permission.js';
import { McpError } from './client.js';
import { formatMcpToolError, formatMcpToolResult } from './format.js';
import { handleMcpElicitation } from './elicitation.js';
import { jsonSchemaToZod } from './json-schema.js';
import type { McpManager, McpWorkspaceSnapshot } from './manager.js';

export interface McpToolsDeps {
  workspaceId: string;
  projectPath: string;
  chatId: string;
  hitl: Pick<IHitlService, 'requestAndWait'>;
  timeoutMs: number;
  elicitationEnabled: boolean;
}

const MAX_NAME_LEN = 64;

export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const name = `mcp__${clean(server)}__${clean(tool)}`;
  return name.length > MAX_NAME_LEN ? name.slice(0, MAX_NAME_LEN) : name;
}

function describeTool(
  server: string,
  tool: string,
  description: string | undefined,
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined,
): string {
  const tags: string[] = [];
  if (annotations?.readOnlyHint) tags.push('read-only');
  if (annotations?.destructiveHint) tags.push('DESTRUCTIVE');
  const tag = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  const base = description?.trim() || `MCP tool ${tool} from server ${server}.`;
  return `[mcp:${server}]${tag} ${base}`;
}

function argsPreview(args: unknown): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 2_000 ? `${json.slice(0, 2_000)}…` : json;
  } catch {
    return '(unserializable arguments)';
  }
}

/**
 * Convert one workspace snapshot into `AgentTool`s.
 * Pure mapping - the only impure part is the `execute` closure.
 */
export function createMcpTools(
  snapshot: McpWorkspaceSnapshot,
  manager: Pick<McpManager, 'callTool'>,
  deps: McpToolsDeps,
): AgentTool[] {
  const seen = new Set<string>();
  const tools: AgentTool[] = [];
  for (const def of snapshot.tools) {
    const name = mcpToolName(def.server, def.name);
    if (seen.has(name) || !name.replace(/_/g, '')) continue;
    seen.add(name);
    const inputSchema = jsonSchemaToZod(def.inputSchema) as z.ZodTypeAny;
    const annotations = def.annotations as
      | { readOnlyHint?: boolean; destructiveHint?: boolean }
      | undefined;
    const readOnly = annotations?.readOnlyHint === true;
    const destructive = annotations?.destructiveHint === true;
    const tool: AgentTool = {
      name,
      description: describeTool(def.server, def.name, def.description, annotations),
      inputSchema,
      execute: async (args: unknown, toolOptions?: AgentToolExecuteOptions) => {
        const argsObj = (args ?? {}) as Record<string, unknown>;
        const decision = await resolveMcpPermissionViaHitl(
          deps.hitl as IHitlService,
          {
            server: def.server,
            tool: def.name,
            readOnly,
            destructive,
            argsPreview: argsPreview(argsObj),
          },
          {
            workspaceId: deps.workspaceId,
            chatId: deps.chatId,
            toolCallId: toolOptions?.toolCallId,
            timeoutMs: deps.timeoutMs,
          },
        );
        if (decision === 'deny') {
          return formatMcpToolError(
            'MCP_APPROVAL_DENIED',
            'Human denied this MCP tool call.',
            def.server,
            def.name,
          );
        }
        let result: Awaited<ReturnType<McpManager['callTool']>>;
        try {
          result = await manager.callTool(
            deps.workspaceId,
            deps.projectPath,
            def.server,
            def.name,
            argsObj,
            {
              timeoutMs: deps.timeoutMs,
            },
          );
        } catch (err) {
          const code = err instanceof McpError ? err.code : 'MCP_CALL_FAILED';
          const message = err instanceof Error ? err.message : String(err);
          return formatMcpToolError(code, message, def.server, def.name);
        }
        // Multi-round-trip: server asks for structured user input mid-call.
        if (isInputRequired(result)) {
          return handleMcpElicitation(result, {
            hitl: deps.hitl as IHitlService,
            workspaceId: deps.workspaceId,
            chatId: deps.chatId,
            toolCallId: toolOptions?.toolCallId,
            timeoutMs: deps.timeoutMs,
            enabled: deps.elicitationEnabled,
            server: def.server,
            tool: def.name,
            retry: (inputResponses, requestState) =>
              manager.callTool(
                deps.workspaceId,
                deps.projectPath,
                def.server,
                def.name,
                {
                  ...argsObj,
                  ...(requestState !== undefined ? { _requestState: requestState } : {}),
                  ...(inputResponses !== undefined ? { _inputResponses: inputResponses } : {}),
                } as Record<string, unknown>,
                { timeoutMs: deps.timeoutMs },
              ),
          });
        }
        if (result.isError) {
          const text = formatMcpToolResult(def.server, def.name, result);
          return `**Error**: \`MCP_TOOL_ERROR\` — tool reported failure\n**Server**: \`${def.server}\` — **Tool**: \`${def.name}\`\n\n${text}\n\n**Suggestion**: Fix the arguments and retry, or continue without this tool.`;
        }
        return formatMcpToolResult(def.server, def.name, result);
      },
    };
    tools.push(tool);
  }
  return tools;
}

function isInputRequired(
  result: unknown,
): result is { resultType: 'input_required' } & Record<string, unknown> {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { resultType?: unknown }).resultType === 'input_required'
  );
}

/**
 * Production entry point: snapshot the workspace, then map to tools.
 * Fail-open - any failure yields zero tools (chat continues without MCP).
 */
export async function getMcpAgentTools(
  ctx: Container,
  workspace: { id: string; projectPath: string },
  chatId: string,
): Promise<AgentTool[]> {
  try {
    if (!ctx.mcpManager.toolsWired) return [];
    const snapshot = await ctx.mcpManager.getSnapshot(workspace.id, workspace.projectPath);
    if (snapshot.tools.length === 0) return [];
    return createMcpTools(snapshot, ctx.mcpManager, {
      workspaceId: workspace.id,
      projectPath: workspace.projectPath,
      chatId,
      hitl: ctx.hitlService,
      timeoutMs: 60_000,
      elicitationEnabled: false,
    });
  } catch (err) {
    ctx.logger.warn(
      { err, workspaceId: workspace.id },
      'mcp: tools unavailable, continuing without MCP tools',
    );
    return [];
  }
}
