import type { McpCallResult } from './client.js';

function safeText(v: unknown): string {
  return String(v).replace(/`/g, "'");
}

export function formatMcpToolError(
  code: string,
  message: string,
  server: string,
  tool: string,
): string {
  const head = `**Error**: \`${code}\` — ${safeText(message)}`;
  const where = `\n**Server**: \`${server}\` — **Tool**: \`${tool}\``;
  if (code === 'MCP_APPROVAL_DENIED') {
    return `${head}${where}\n**Suggestion**: Human denied this MCP tool call. Proceed without it or ask the user for an alternative.`;
  }
  if (code === 'MCP_TIMEOUT') {
    return `${head}${where}\n**Suggestion**: The MCP server took too long. Retry with simpler arguments or check the server process.`;
  }
  if (code === 'MCP_NOT_CONNECTED' || code === 'MCP_CONNECT_FAILED') {
    return `${head}${where}\n**Suggestion**: The MCP server is unreachable. Verify its command/URL in \`.mcp.json\` and retry.`;
  }
  return `${head}${where}\n**Suggestion**: Fix the tool arguments and retry, or continue without this tool.`;
}

/** For now, text-only rendering of an MCP `tools/call` result (model context). */
export function formatMcpToolResult(server: string, tool: string, result: McpCallResult): string {
  const blocks: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push(block.text);
    } else {
      const kind = typeof block.type === 'string' && block.type ? block.type : 'non-text';
      blocks.push(`_(${kind} content from ${server}/${tool}, omitted from context)_`);
    }
  }
  let body = blocks.join('\n\n').trim();
  if (!body) body = '_(empty result)_';
  // Cap context cost: MCP servers can return huge blobs.
  if (body.length > 12_000) {
    body = `${body.slice(0, 12_000)}\n\n_(truncated, ${body.length - 12_000} chars omitted)_`;
  }
  return body;
}
