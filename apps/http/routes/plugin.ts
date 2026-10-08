import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { getPlugin, listPlugins, setPluginEnabled } from '../../actions/index.js';
import {
  validatePluginGet,
  validatePluginSetEnabled,
  validatePluginWorkspace,
} from '../../validators/plugin.js';
import { z } from 'zod';

const PluginPathSchema = z.object({
  id: z.string().min(1),
  pluginId: z.string().min(1),
});

const PluginSetEnabledBodySchema = z.object({
  enabled: z.boolean(),
});

export function registerPluginRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:id/plugins', async (req) => {
    const { workspaceId } = validatePluginWorkspace({
      workspaceId: (req.params as { id: string }).id,
    });
    return listPlugins(ctx, { workspaceId });
  });

  app.get('/workspaces/:id/plugins/:pluginId', async (req) => {
    const path = PluginPathSchema.parse(req.params);
    const input = validatePluginGet({ workspaceId: path.id, id: path.pluginId });
    return getPlugin(ctx, input);
  });

  app.put('/workspaces/:id/plugins/:pluginId', async (req) => {
    const path = PluginPathSchema.parse(req.params);
    const body = PluginSetEnabledBodySchema.parse(req.body);
    const input = validatePluginSetEnabled({
      workspaceId: path.id,
      id: path.pluginId,
      enabled: body.enabled,
    });
    return setPluginEnabled(ctx, input);
  });
}
