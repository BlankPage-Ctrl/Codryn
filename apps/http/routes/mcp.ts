import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { listMcpServers, setMcpServerEnabled } from '../../actions/index.js';
import { validateMcpList, validateMcpSetEnabled } from '../../validators/mcp.js';
import { z } from 'zod';

const McpServerPathSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const McpSetEnabledBodySchema = z.object({
  enabled: z.boolean(),
});

export function registerMcpRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:id/mcp/servers', async (req) => {
    const { workspaceId } = validateMcpList({ workspaceId: (req.params as { id: string }).id });
    return listMcpServers(ctx, { workspaceId });
  });

  app.put('/workspaces/:id/mcp/servers/:name', async (req) => {
    const path = McpServerPathSchema.parse(req.params);
    const body = McpSetEnabledBodySchema.parse(req.body);
    const input = validateMcpSetEnabled({
      workspaceId: path.id,
      name: path.name,
      enabled: body.enabled,
    });
    return setMcpServerEnabled(ctx, input);
  });
}
