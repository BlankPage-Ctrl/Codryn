import type { AgentTool, AgentToolExecuteOptions } from '../../src/agent/index.js';
import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { PluginHost } from './host.js';
import type { PluginToolContract } from './contract.js';
import { resolvePluginPermissionViaHitl } from '../shared/plugin-permission.js';
import { jsonSchemaToZod } from '../mcp/json-schema.js';
import { z } from 'zod';

export interface PluginToolBridgeDeps {
  host: PluginHost;
  hitl: IHitlService;
  workspaceId: string;
  chatId: string;
  hitlTimeoutMs?: number;
}

/** Tool name is namespaced as "pluginId__toolName". */
export function createPluginTool(
  pluginId: string,
  tool: PluginToolContract,
  deps: PluginToolBridgeDeps,
): AgentTool {
  const namespacedName = `${pluginId}__${tool.name}`;
  const inputSchema = jsonSchemaToZod(tool.inputSchema) as z.ZodTypeAny;

  return {
    name: namespacedName,
    description: tool.description,
    inputSchema,
    execute: async (args: unknown, opts?: AgentToolExecuteOptions) => {
      const argsObj = (args ?? {}) as Record<string, unknown>;
      const toolCallId = opts?.toolCallId;

      if (tool.isSensitive || tool.destructive) {
        const decision = await resolvePluginPermissionViaHitl(
          deps.hitl,
          {
            plugin: pluginId,
            tool: tool.name,
            sensitive: tool.isSensitive,
            destructive: tool.destructive,
            argsPreview: JSON.stringify(argsObj).slice(0, 2_000),
          },
          {
            workspaceId: deps.workspaceId,
            chatId: deps.chatId,
            toolCallId,
            timeoutMs: deps.hitlTimeoutMs,
          },
        );

        if (decision === 'deny') {
          return `**Plugin tool denied**: The user rejected the ${tool.name} tool call.`;
        }
      }

      deps.host.dispatchHook('beforeTool', {
        pluginId,
        tool: tool.name,
        args: argsObj,
        toolCallId,
        timestamp: Date.now(),
      });

      let result;
      try {
        result = await deps.host.callTool(namespacedName, argsObj, toolCallId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `**Plugin tool error**: ${namespacedName} failed - ${message}`;
      }

      deps.host.dispatchHook('afterTool', {
        pluginId,
        tool: tool.name,
        result: result.text,
        toolCallId,
        timestamp: Date.now(),
      });

      if (!result.ok) {
        const code = result.code ?? 'TOOL_ERROR';
        const msg = result.message ?? 'Unknown error';
        return `**Plugin tool error** [${code}]: ${msg}`;
      }

      return result.text;
    },
  };
}

export function createPluginTools(
  pluginId: string,
  tools: PluginToolContract[],
  deps: PluginToolBridgeDeps,
): AgentTool[] {
  return tools.map((tool) => createPluginTool(pluginId, tool, deps));
}
