import type { IHitlService } from '../../src/human-in-the-loop/index.js';
import type { McpCallResult } from './client.js';
import { formatMcpToolResult } from './format.js';

export interface McpElicitationHandlerOptions {
  hitl: Pick<IHitlService, 'requestAndWait'>;
  workspaceId: string;
  chatId: string;
  toolCallId?: string;
  timeoutMs: number;
  enabled: boolean;
  server: string;
  tool: string;
  retry: (
    inputResponses: Record<string, { action: 'accept' | 'reject' | 'cancel'; content?: unknown }>,
    requestState?: unknown,
  ) => Promise<McpCallResult>;
}

interface ElicitationAsk {
  key: string;
  message: string;
  schema: Record<string, unknown> | undefined;
}

const SENSITIVE_RE = /password|passwd|token|secret|api[-_ ]?key|credential|private[-_ ]?key/i;

function parseRequests(result: Record<string, unknown>): ElicitationAsk[] {
  const inputRequests = result.inputRequests;
  if (typeof inputRequests !== 'object' || inputRequests === null) return [];
  const out: ElicitationAsk[] = [];
  for (const [key, req] of Object.entries(inputRequests as Record<string, unknown>)) {
    if (typeof req !== 'object' || req === null) continue;
    const r = req as { method?: unknown; params?: unknown };
    if (r.method !== 'elicitation/create') continue;
    const params = (r.params ?? {}) as { message?: unknown; requestedSchema?: unknown };
    out.push({
      key,
      message:
        typeof params.message === 'string' ? params.message : `Additional input needed for ${key}.`,
      schema:
        typeof params.requestedSchema === 'object' && params.requestedSchema !== null
          ? (params.requestedSchema as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

function sensitiveProps(schema: Record<string, unknown> | undefined): string[] {
  if (!schema) return [];
  const props = schema.properties;
  if (typeof props !== 'object' || props === null) return [];
  return Object.keys(props as Record<string, unknown>).filter((k) => SENSITIVE_RE.test(k));
}

/**
 * Handle an MCP `InputRequiredResult` carrying `elicitation/create` requests.
 *
 * STABLE but NOT wired to production (`enabled:false` there): when disabled,
 * returns a model-friendly notice instead of prompting the human. When
 * enabled, collects each form via HITL `ask` and retries the original
 * `tools/call` with `inputResponses` + echoed `requestState`.
 */
export async function handleMcpElicitation(
  result: { resultType: 'input_required' } & Record<string, unknown>,
  opts: McpElicitationHandlerOptions,
): Promise<string> {
  const asks = parseRequests(result);
  if (asks.length === 0) {
    return (
      `**Error**: \`MCP_INPUT_REQUIRED\` — server requested additional input in an unknown shape.\n` +
      `**Server**: \`${opts.server}\` — **Tool**: \`${opts.tool}\`\n` +
      `**Suggestion**: Retry with more complete arguments, or continue without this tool.`
    );
  }
  if (!opts.enabled) {
    const needed = asks.map((a) => `\`${a.key}\`: ${a.message}`).join('\n');
    return (
      `**Error**: \`MCP_ELICITATION_DISABLED\` — the MCP server needs more input before it can finish.\n` +
      `**Server**: \`${opts.server}\` — **Tool**: \`${opts.tool}\`\n\n${needed}\n\n` +
      `**Suggestion**: Elicitation is not enabled yet. Ask the user for the missing details in chat, then retry \`mcp__${opts.server}__${opts.tool}\` with complete arguments.`
    );
  }
  for (const ask of asks) {
    const bad = sensitiveProps(ask.schema);
    if (bad.length > 0) {
      return (
        `**Error**: \`MCP_ELICITATION_REFUSED\` — server asked for sensitive data (${bad.map((b) => `\`${b}\``).join(', ')}), which elicitation must never collect.\n` +
        `**Server**: \`${opts.server}\` — **Tool**: \`${opts.tool}\`\n` +
        `**Suggestion**: Do not provide credentials. Continue without this tool or ask the user to configure the server out-of-band.`
      );
    }
  }
  const inputResponses: Record<
    string,
    { action: 'accept' | 'reject' | 'cancel'; content?: unknown }
  > = {};
  for (const ask of asks) {
    const props = ask.schema?.properties as Record<string, { description?: unknown }> | undefined;
    const fields = props ? Object.keys(props).join(', ') : 'value';
    let request: Awaited<ReturnType<IHitlService['requestAndWait']>>;
    try {
      request = await (opts.hitl as IHitlService).requestAndWait({
        type: 'ask',
        title: `MCP input: ${opts.server}/${opts.tool}`,
        description: `${ask.message}\n\nFields: ${fields}`,
        chatId: opts.chatId,
        workspaceId: opts.workspaceId,
        executionId: opts.toolCallId,
        timeoutMs: opts.timeoutMs,
        metadata: { source: 'mcp-elicitation', server: opts.server, tool: opts.tool, key: ask.key },
      });
    } catch {
      return (
        `**Error**: \`MCP_ELICITATION_TIMEOUT\` — human did not respond in time.\n` +
        `**Server**: \`${opts.server}\` — **Tool**: \`${opts.tool}\`\n` +
        `**Suggestion**: Ask the user for the missing details in chat and retry.`
      );
    }
    if (request.type !== 'ask' || !request.response) {
      inputResponses[ask.key] = { action: 'cancel' };
      continue;
    }
    const resp = request.response as { value?: unknown; outcome?: unknown };
    if (typeof resp.value === 'string' && ask.schema) {
      try {
        inputResponses[ask.key] = { action: 'accept', content: JSON.parse(resp.value) };
      } catch {
        inputResponses[ask.key] = { action: 'accept', content: { value: resp.value } };
      }
    } else {
      inputResponses[ask.key] = { action: 'accept', content: (resp.value ?? {}) as unknown };
    }
  }
  const requestState = (result as { requestState?: unknown }).requestState;
  const retried = await opts.retry(inputResponses, requestState);
  if (retried.isError) {
    return (
      `**Error**: \`MCP_TOOL_ERROR\` — tool reported failure after elicitation.\n` +
      `**Server**: \`${opts.server}\` — **Tool**: \`${opts.tool}\`\n\n${formatMcpToolResult(opts.server, opts.tool, retried)}`
    );
  }
  return formatMcpToolResult(opts.server, opts.tool, retried);
}
