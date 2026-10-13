import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import {
  getPlugin,
  listPlugins,
  setPluginEnabled,
  registerPlugin,
  unregisterPlugin,
  discoverPlugins,
} from '../../actions/index.js';
import {
  validatePluginGet,
  validatePluginRegister,
  validatePluginSetEnabled,
  validatePluginUnregister,
  validatePluginWorkspace,
} from '../../validators/plugin.js';
import { z } from 'zod';

const PluginPathSchema = z.object({
  id: z.string().min(1),
  pluginId: z.string().min(1),
});

const PluginIdParamSchema = z.object({
  pluginId: z.string().min(1),
});

const PluginSetEnabledBodySchema = z.object({
  enabled: z.boolean(),
});

const RegisterPluginBodySchema = z.object({
  pluginId: z.string().min(1),
  pluginDir: z.string().min(1).optional(),
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

  app.post('/plugins/discover', async () => {
    return discoverPlugins(ctx);
  });

  app.post('/plugins/register', async (req) => {
    const body = RegisterPluginBodySchema.parse(req.body);
    const input = validatePluginRegister({ pluginId: body.pluginId, pluginDir: body.pluginDir });
    return registerPlugin(ctx, { pluginId: input.pluginId, pluginDir: input.pluginDir });
  });

  app.delete('/plugins/:pluginId', async (req) => {
    const path = PluginIdParamSchema.parse(req.params);
    const input = validatePluginUnregister({ pluginId: path.pluginId });
    return unregisterPlugin(ctx, { pluginId: input.pluginId });
  });
}
