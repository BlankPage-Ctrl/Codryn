import { listMcpServers, setMcpServerEnabled } from '../../actions/index.js';
import { McpListParamsSchema, McpSetEnabledParamsSchema } from '../../validators/mcp.js';
import { act, type StdioMethod } from './types.js';

export const mcpMethods: Record<string, StdioMethod> = {
  'list.mcp-server': {
    kind: 'plain',
    validate: (p) => McpListParamsSchema.parse(p),
    run: act(listMcpServers),
  },
  'set.mcp-server': {
    kind: 'plain',
    validate: (p) => McpSetEnabledParamsSchema.parse(p),
    run: act(setMcpServerEnabled),
  },
};
